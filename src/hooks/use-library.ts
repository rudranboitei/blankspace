"use client";

import type { Verdict } from "@/lib/match";
import { daysUntilNextReview, MAX_BOX } from "@/lib/saved-patterns";
import type { Topic } from "@/lib/topics";

// Unchanged on purpose. Records saved before spaced review existed have no `box` or
// `dueAt`; keeping the same key lets `toPattern` fill those in instead of orphaning them.
const STORAGE_KEY = "pattern-practice:library:v1";

const DAY_MS = 24 * 60 * 60 * 1000;

export { MAX_BOX };

/**
 * A saved snapshot, not a reference into the bank. If an item is later reworded in the
 * bank, the learner still reviews what they were actually taught.
 */
export type SavedPattern = {
  id: string;
  /** The bank item this came from, e.g. "tw-014". */
  bankId: string;
  topic: Topic;
  hindi: string;
  accepted: string[];
  correctPhrase: string;
  pattern: string;
  variations: string[];
  /** What the learner wrote, kept so review can show what they originally reached for. */
  yourAnswer: string;
  verdict: Verdict;
  savedAt: number;
  /** 1 to MAX_BOX. Higher means the recall has held up more often. */
  box: number;
  /** Epoch ms when this pattern is next due for review. */
  dueAt: number;
};

function clampBox(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), MAX_BOX);
}

/** Anything saved before spaced review existed is due right away. */
function toPattern(value: unknown): SavedPattern | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.hindi !== "string" ||
    typeof item.correctPhrase !== "string" ||
    typeof item.pattern !== "string" ||
    !Array.isArray(item.variations)
  ) {
    return null;
  }

  const savedAt = typeof item.savedAt === "number" ? item.savedAt : 0;

  return {
    id: item.id,
    bankId: typeof item.bankId === "string" ? item.bankId : item.id,
    topic: (typeof item.topic === "string" ? item.topic : "tech-work") as Topic,
    hindi: item.hindi,
    accepted: Array.isArray(item.accepted) ? item.accepted.map(String) : [item.correctPhrase],
    correctPhrase: item.correctPhrase,
    pattern: item.pattern,
    variations: item.variations.map(String),
    yourAnswer: typeof item.yourAnswer === "string" ? item.yourAnswer : "",
    verdict: (typeof item.verdict === "string" ? item.verdict : "almost") as Verdict,
    savedAt,
    box: clampBox(item.box as number),
    dueAt: typeof item.dueAt === "number" ? item.dueAt : savedAt,
  };
}

/**
 * Reads through every time rather than holding a copy.
 *
 * A cached copy has to be invalidated when another tab writes, and the two callers here are
 * not in the same place: the library reads on mount, the migration reads once just after a
 * sign in. Reading a few kilobytes of JSON costs nothing next to getting this wrong, so there
 * is nothing to invalidate.
 */
function read(): SavedPattern[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(toPattern).filter((item): item is SavedPattern => item !== null)
      : [];
  } catch {
    return [];
  }
}

function write(next: SavedPattern[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the session still works, it just won't persist.
  }
}

/**
 * The guest store: plain functions rather than a hook, because every caller is an event
 * handler. A hook cannot be run from one, and the screens only ever read the store again
 * immediately after writing to it.
 *
 * The ladder itself lives in `saved-patterns` so the guest store and the database agree on
 * what a box means, and a pattern saved as a guest keeps the same review schedule once it
 * has been migrated.
 */

export function readGuestPatterns(): SavedPattern[] {
  return read();
}

/** Replaces the store, used to keep only the saves a migration could not hand over. */
export function writeGuestPatterns(patterns: SavedPattern[]) {
  write(patterns);
}

export function saveGuestPattern(input: Omit<SavedPattern, "id" | "savedAt" | "box" | "dueAt">) {
  const current = read();
  // One snapshot per sentence: the same one is not worth saving twice however many ways the
  // learner got it right.
  if (current.some((item) => item.bankId === input.bankId)) return false;

  const now = Date.now();
  write([
    {
      ...input,
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: now,
      // Due straight away, so a new save is reviewable in the same sitting.
      box: 1,
      dueAt: now,
    },
    ...current,
  ]);
  return true;
}

export function removeGuestPattern(id: string) {
  write(read().filter((item) => item.id !== id));
}

/** Puts an undone removal back, with the box and due date it had. */
export function restoreGuestPattern(pattern: SavedPattern) {
  const current = read();
  if (current.some((item) => item.id === pattern.id)) return;
  write([pattern, ...current]);
}

/**
 * Moves one pattern up the ladder, or resets it to box 1 and due now.
 *
 * Mirrors `ratePattern` in `saved-patterns` so a guest's box means the same thing as an
 * account's, and a migrated save lands on the schedule it had as a guest.
 */
export function reviewGuestPattern(id: string, gotIt: boolean): SavedPattern | null {
  const current = read();
  const index = current.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const updated: SavedPattern = {
    ...current[index],
    box: gotIt ? Math.min(current[index].box + 1, MAX_BOX) : 1,
    dueAt: Date.now() + (gotIt ? daysUntilNextReview(current[index].box) * DAY_MS : 0),
  };

  const next = [...current];
  next[index] = updated;
  write(next);
  return updated;
}
