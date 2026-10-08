import "server-only";

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

/**
 * The only client in the app that bypasses Row Level Security, and it exists for one
 * table: `explanations` has no policies, so no anon or authenticated request can read or
 * write it. Route handlers reach it through here.
 *
 * The key is read from `SUPABASE_SERVICE_ROLE_KEY` and never leaves the server. Never
 * import this from a Client Component, and never name the variable with a `NEXT_PUBLIC_`
 * prefix, which would inline it into the browser bundle.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "The server is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "The Explain cache needs the service role key; add it to .env.local.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The cache key for one answer to one sentence.
 *
 * `mode` is folded into the hash because the table's unique key is
 * `(sentence_id, answer_hash)` with no mode column, so hashing the answer alone would make
 * Explain and check-my-answer collide on the same wording. Hashing `mode:answer` keeps them
 * separate rows while still satisfying the unique constraint.
 *
 * Hashed rather than stored so the cache stays a lookup and not a second copy of everything
 * a learner has typed.
 */
export function answerHash(mode: "explain" | "verify", normalizedAnswer: string) {
  return createHash("sha256").update(`${mode}:${normalizedAnswer}`).digest("hex");
}