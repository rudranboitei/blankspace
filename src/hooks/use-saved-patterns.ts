"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readGuestPatterns,
  removeGuestPattern,
  restoreGuestPattern,
  reviewGuestPattern,
  saveGuestPattern,
} from "@/hooks/use-library";
import {
  fetchSavedPatterns,
  ratePattern as rateInDatabase,
  removePattern as removeFromDatabase,
  savePattern as saveToDatabase,
  type Rating,
  type SavedRow,
} from "@/lib/saved-patterns";
import type { BankItem } from "@/lib/schema";
import { currentUserId, refreshSession } from "@/lib/session";

export type PatternStore = {
  rows: SavedRow[];
  /** Which backend answered, so the UI can say so and the calls can route. */
  source: "account" | "guest";
  isLoading: boolean;
  error: string | null;
  /** `sentence` is needed because the guest store keeps a snapshot and has no bank to look it up in. */
  save: (input: { sentence: BankItem; userAnswer: string }) => Promise<void>;
  remove: (row: SavedRow) => Promise<void>;
  /** Puts an undone removal back with the progress it had, rather than restarting it. */
  restore: (row: SavedRow) => Promise<void>;
  rate: (row: SavedRow, gotIt: boolean) => Promise<void>;
  reload: () => Promise<void>;
};

/** The guest store keeps its own shape, so it needs widening to the shared row type. */
function guestRows(): SavedRow[] {
  return readGuestPatterns().map((pattern) => ({
    id: pattern.id,
    sentenceId: pattern.bankId,
    userAnswer: pattern.yourAnswer,
    box: pattern.box,
    nextReviewAt: new Date(pattern.dueAt).toISOString(),
    createdAt: new Date(pattern.savedAt).toISOString(),
    sentence: {
      id: pattern.bankId,
      topic: pattern.topic,
      hindi: pattern.hindi,
      accepted: pattern.accepted,
      correctPhrase: pattern.correctPhrase,
      pattern: pattern.pattern,
      variations: pattern.variations,
    },
  }));
}

/**
 * The learner's saved patterns, from the database when there is an account and from
 * localStorage when there is not.
 *
 * Both backends are refetched whole after a write rather than patched in place, so a row and
 * the sentence it points at can never drift apart.
 */
export function useSavedPatterns(): PatternStore {
  const [rows, setRows] = useState<SavedRow[]>([]);
  const [source, setSource] = useState<"account" | "guest">("guest");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const userId = await refreshSession();
    const useDatabase = Boolean(userId);

    setSource(useDatabase ? "account" : "guest");
    try {
      setRows(useDatabase ? await fetchSavedPatterns() : guestRows());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load your library. Try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Every state update lands after an await inside the callback, so nothing here sets state
  // in the body of the effect.
  useEffect(() => {
    let live = true;

    void (async () => {
      const userId = await refreshSession();
      const useDatabase = Boolean(userId);
      if (!live) return;
      setSource(useDatabase ? "account" : "guest");

      try {
        const fetched = useDatabase ? await fetchSavedPatterns() : guestRows();
        if (!live) return;
        setRows(fetched);
        setError(null);
      } catch (cause) {
        if (!live) return;
        setError(
          cause instanceof Error ? cause.message : "Couldn't load your library. Try again.",
        );
      } finally {
        if (live) setIsLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(
    async (input: { sentence: BankItem; userAnswer: string }) => {
      if (currentUserId()) {
        // The database stores an id, so the sentence never travels.
        await saveToDatabase({ sentenceId: input.sentence.id, userAnswer: input.userAnswer });
      } else {
        // The guest store keeps a snapshot, so it needs the whole sentence.
        const added = saveGuestPattern({
          bankId: input.sentence.id,
          topic: input.sentence.topic,
          hindi: input.sentence.hindi,
          accepted: input.sentence.accepted,
          correctPhrase: input.sentence.correctPhrase,
          pattern: input.sentence.pattern,
          variations: input.sentence.variations,
          yourAnswer: input.userAnswer,
          verdict: "almost",
        });
        if (!added) throw new Error("That pattern is already in your library.");
      }

      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (row: SavedRow) => {
      if (currentUserId()) await removeFromDatabase(row.id);
      else removeGuestPattern(row.id);
      await load();
    },
    [load],
  );

  const restore = useCallback(
    async (row: SavedRow) => {
      if (currentUserId()) {
        await saveToDatabase({
          sentenceId: row.sentenceId,
          userAnswer: row.userAnswer ?? "",
          box: row.box,
          nextReviewAt: row.nextReviewAt,
        });
      } else {
        // Guest ids are generated locally, so the whole snapshot has to come back.
        restoreGuestPattern({
          id: row.id,
          bankId: row.sentenceId,
          topic: row.sentence.topic,
          hindi: row.sentence.hindi,
          accepted: row.sentence.accepted,
          correctPhrase: row.sentence.correctPhrase,
          pattern: row.sentence.pattern,
          variations: row.sentence.variations,
          yourAnswer: row.userAnswer ?? "",
          verdict: "almost",
          savedAt: new Date(row.createdAt).getTime(),
          box: row.box,
          dueAt: new Date(row.nextReviewAt).getTime(),
        });
      }
      await load();
    },
    [load],
  );

  const rate = useCallback(
    async (row: SavedRow, gotIt: boolean) => {
      if (currentUserId()) await rateInDatabase(row.id, (gotIt ? "got-it" : "again") as Rating);
      else reviewGuestPattern(row.id, gotIt);
      await load();
    },
    [load],
  );

  return { rows, source, isLoading, error, save, remove, restore, rate, reload: load };
}