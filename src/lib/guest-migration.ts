"use client";

import { readGuestPatterns, writeGuestPatterns, type SavedPattern } from "@/hooks/use-library";
import { savePattern } from "@/lib/saved-patterns";
import { refreshSession } from "@/lib/session";

/** Set once the store has been handed over, so a later visit does not look for it again. */
const MIGRATED_FLAG = "pattern-practice:guest-migrated:v1";

export type MigrationResult = {
  migrated: number;
  /** True when there was nothing to do: no session, no flag written, or nothing saved. */
  skipped: boolean;
  /** Rows that could not be moved and are still in the browser. */
  stranded: number;
};

/**
 * Moves a guest's localStorage saves into `saved_patterns` the first time there is an account
 * to move them into, then empties the store.
 *
 * Idempotent twice over. The flag stops it running again, and the write itself is an upsert on
 * `(user_id, sentence_id)`, so a guest who saves a pattern, signs in, and signs out gets the
 * same row back rather than a duplicate. The Leitner box travels with the row, so an account
 * that started as a guest keeps the review schedule it had.
 *
 * A save that will not go is kept in the browser rather than dropped or allowed to block the
 * rest, and the flag is left unwritten so the next visit tries again. That happens when a
 * sentence has been retired since it was saved: the row cannot exist without its sentence.
 *
 * Never throws. This is housekeeping, and it must not stop anyone practising.
 */
export async function migrateGuestSaves(): Promise<MigrationResult> {
  try {
    if (typeof window === "undefined") return { migrated: 0, skipped: true, stranded: 0 };
    if (window.localStorage.getItem(MIGRATED_FLAG)) return { migrated: 0, skipped: true, stranded: 0 };

    // Ask for the session rather than reading the cache: this first runs on the page straight
    // after a sign in, where nothing has had a chance to record who turned up yet.
    if (!(await refreshSession())) return { migrated: 0, skipped: true, stranded: 0 };

    const guests = readGuestPatterns();
    if (guests.length === 0) {
      window.localStorage.setItem(MIGRATED_FLAG, "1");
      return { migrated: 0, skipped: false, stranded: 0 };
    }

    const stranded: SavedPattern[] = [];
    let migrated = 0;

    for (const pattern of guests) {
      try {
        await savePattern({
          sentenceId: pattern.bankId,
          userAnswer: pattern.yourAnswer,
          box: pattern.box,
          nextReviewAt: new Date(pattern.dueAt).toISOString(),
        });
        migrated++;
      } catch (cause) {
        console.error("[migration] could not move", pattern.bankId, cause);
        stranded.push(pattern);
      }
    }

    // Whatever moved is gone; whatever did not is still here, so nothing is ever lost.
    writeGuestPatterns(stranded);
    if (stranded.length === 0) window.localStorage.setItem(MIGRATED_FLAG, "1");

    return { migrated, skipped: false, stranded: stranded.length };
  } catch (cause) {
    console.error("[migration] failed:", cause);
    return { migrated: 0, skipped: false, stranded: 0 };
  }
}
