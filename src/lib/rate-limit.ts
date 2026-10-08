import "server-only";

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How much model one caller may spend, per window.
 *
 * Signed in, the allowance is per account: a shared address cannot spend someone else's, and
 * changing networks cannot escape your own.
 *
 * Signed out there is no account, so the allowance is per address. That is the weakest of the
 * three and worth being honest about: whoever controls the header this reads can present a
 * new address on every request and never hit a limit. This is a fairness limit that keeps an
 * accidental loop or a bored person from spending the budget, not a security boundary. The
 * thing that actually bounds cost is the `explanations` cache, which is keyed by sentence and
 * answer and shared by everyone, and the daily cap for anyone reusing real addresses.
 *
 * Neither applies to an account in `coach_exemptions`, which the database checks before any
 * of this. Adding yourself to it is one INSERT, and there is no env var to set or redeploy.
 */
const LIMITS = {
  account: { perMinute: 10, perDay: 100 },
  guest: { perMinute: 5, perDay: 25 },
} as const;

/** A minute of wall clock, for naming the short window. */
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type QuotaVerdict = {
  allowed: boolean;
  /** What the caller is told, written for a person rather than a log. */
  message: string;
  /** Seconds to wait, sent as `Retry-After`. */
  retryAfterSeconds: number;
};

/**
 * The address the request claims to have come from.
 *
 * `x-forwarded-for` is set by the platform in front of the app, and the first entry is the
 * original sender. On a platform that overwrites the header rather than appending to it, no
 * caller can choose this value. Where the platform only appends, the first entry is whatever
 * the caller sent and the guest limit is trivially bypassed, which is why the comment on
 * `LIMITS` calls this a fairness limit rather than a boundary.
 */
function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

/**
 * A stable, opaque name for one caller.
 *
 * For an account this is the user id, which is already a random uuid. For a guest it is an
 * HMAC of the address, so the table never holds a raw IP: the digest cannot be turned back
 * into one without the salt, and the salt is the service role key, which never leaves the
 * server. Rotating that key resets every guest counter, which costs nothing.
 */
function subjectFor(userId: string | null, request: Request) {
  if (userId) return { subject: `u:${userId}`, limits: LIMITS.account };

  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "no-salt-configured";
  const digest = createHmac("sha256", salt).update(clientAddress(request)).digest("hex");

  return { subject: `ip:${digest.slice(0, 32)}`, limits: LIMITS.guest };
}

/**
 * Fixed windows, named by where they start.
 *
 * The minute window rolls on the minute and the day window on midnight UTC, so both can be
 * derived from the same instant. `expiresAt` is the moment the window stops counting, which
 * is when the next one begins.
 */
function windows(now: Date) {
  const minuteStart = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);

  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  return {
    minuteBucket: `m:${minuteStart.toISOString()}`,
    minuteExpiresAt: new Date(minuteStart.getTime() + MINUTE_MS),
    dayBucket: `d:${dayStart.toISOString().slice(0, 10)}`,
    dayExpiresAt: new Date(dayStart.getTime() + DAY_MS),
  };
}

const secondsUntil = (at: Date, now: Date) =>
  Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 1000));

/**
 * Spends one unit of the caller's allowance, or reports that they are out.
 *
 * The counting happens in `consume_coach_quota` rather than here, because the increment has
 * to be atomic. Read-then-write in the app would let two simultaneous requests both see the
 * same count and both be let through.
 *
 * Callers must invoke this only when a call is actually going to be made. A cached answer
 * cost nothing to produce, and charging for it would tax this learner for someone else's
 * earlier call.
 */
export async function consumeCoachQuota(options: {
  admin: SupabaseClient;
  userId: string | null;
  request: Request;
  now?: Date;
}): Promise<QuotaVerdict> {
  const { admin, userId, request } = options;
  const now = options.now ?? new Date();

  const { subject, limits } = subjectFor(userId, request);
  const window = windows(now);

  const { data, error } = await admin.rpc("consume_coach_quota", {
    p_subject: subject,
    // Null for a guest. The function checks the exemption list itself, so an exempt account
    // costs no extra query and writes no counters.
    p_user_id: userId,
    p_minute_bucket: window.minuteBucket,
    p_minute_limit: limits.perMinute,
    p_minute_expires_at: window.minuteExpiresAt.toISOString(),
    p_day_bucket: window.dayBucket,
    p_day_limit: limits.perDay,
    p_day_expires_at: window.dayExpiresAt.toISOString(),
  });

  // A quota service that cannot answer must not become a way to spend for free. Refuse, and
  // say so, rather than letting the request through unchecked.
  if (error) {
    console.error("[rate-limit] could not read quota:", error.message);
    return {
      allowed: false,
      message: "Couldn't check your allowance just now. Try again in a moment.",
      retryAfterSeconds: 30,
    };
  }

  const row = data?.[0];
  if (!row) {
    return {
      allowed: false,
      message: "Couldn't check your allowance just now. Try again in a moment.",
      retryAfterSeconds: 30,
    };
  }

  if (row.allowed) return { allowed: true, message: "", retryAfterSeconds: 0 };

  // Out for the day is the one worth saying plainly, because waiting a minute will not help.
  if (row.day_used >= row.day_limit) {
    return {
      allowed: false,
      message:
        "That's today's allowance used up. Saved patterns and reviews keep working, and the coach is back tomorrow.",
      retryAfterSeconds: secondsUntil(window.dayExpiresAt, now),
    };
  }

  return {
    allowed: false,
    message: "Too many questions just now. Give it a minute and try again.",
    retryAfterSeconds: secondsUntil(window.minuteExpiresAt, now),
  };
}
