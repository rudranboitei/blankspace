"use client";

import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/session";
import type { BankItem } from "@/lib/schema";
import type { Topic } from "@/lib/topics";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a pattern waits after a learner says "Got it". The interval is chosen from the box
 * they were in at the time, so the first step is one day and the ladder doubles from there.
 *
 * Anything marked "Again" is not on this ladder at all: it goes back to box 1 and is due
 * immediately, so it comes back before the sitting ends.
 */
export const REVIEW_DAYS = [1, 2, 4, 8, 16] as const;

/** Matches the `saved_patterns_box_range` check constraint. */
export const MAX_BOX = 6;

export function daysUntilNextReview(box: number) {
  const index = Math.min(Math.max(box, 1), REVIEW_DAYS.length) - 1;
  return REVIEW_DAYS[index];
}

/** A save joined with the sentence it points at, which is what the library renders. */
export type SavedRow = {
  id: string;
  sentenceId: string;
  userAnswer: string | null;
  box: number;
  nextReviewAt: string;
  createdAt: string;
  sentence: BankItem;
};

type JoinedRow = {
  id: string;
  sentence_id: string;
  user_answer: string | null;
  box: number;
  next_review_at: string;
  created_at: string;
  // supabase-js cannot tell that this foreign key is to-one, so it types the embed as an
  // array. The cast is the price of not generating types for the schema.
  sentences: {
    id: string;
    topic: string;
    hindi: string;
    accepted: string[] | null;
    correct_phrase: string;
    pattern: string;
    variations: unknown;
  } | null;
};

const SELECT = `
  id, sentence_id, user_answer, box, next_review_at, created_at,
  sentences(id, topic, hindi, accepted, correct_phrase, pattern, variations)
`;

function toSavedRow(row: JoinedRow): SavedRow | null {
  const sentence = row.sentences;
  // A sentence that was retired or deleted leaves a hole; it is not worth rendering.
  if (!sentence) return null;

  return {
    id: row.id,
    sentenceId: row.sentence_id,
    userAnswer: row.user_answer,
    box: row.box,
    nextReviewAt: row.next_review_at,
    createdAt: row.created_at,
    sentence: {
      id: sentence.id,
      topic: sentence.topic as Topic,
      hindi: sentence.hindi,
      accepted: sentence.accepted ?? [],
      correctPhrase: sentence.correct_phrase,
      pattern: sentence.pattern,
      variations: Array.isArray(sentence.variations) ? sentence.variations.map(String) : [],
    },
  };
}

/** Everything the learner has kept, soonest review first. */
export async function fetchSavedPatterns(): Promise<SavedRow[]> {
  const { data, error } = await createClient()
    .from("saved_patterns")
    .select(SELECT)
    .order("next_review_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as unknown as JoinedRow[])
    .map(toSavedRow)
    .filter((row): row is SavedRow => row !== null);
}

/**
 * Keeps a pattern. One row per sentence per learner, so saving the same one again updates
 * the answer they wrote rather than piling up duplicates.
 *
 * `box` and `nextReviewAt` exist for putting an undone removal back with the progress it had,
 * rather than restarting it at box 1.
 */
export async function savePattern(input: {
  sentenceId: string;
  userAnswer: string;
  box?: number;
  nextReviewAt?: string;
}) {
  const userId = currentUserId();
  if (!userId) throw new Error("Sign in to save a pattern.");

  const { data, error } = await createClient()
    .from("saved_patterns")
    .upsert(
      {
        // Spelled out rather than left to the column default, so the conflict target has a
        // value in the statement. PostgREST defaults on_conflict to the primary key, and
        // the unique constraint that matters here is on (user_id, sentence_id).
        user_id: userId,
        sentence_id: input.sentenceId,
        user_answer: input.userAnswer,
        box: input.box ?? 1,
        next_review_at: input.nextReviewAt ?? new Date().toISOString(),
      },
      { onConflict: "user_id,sentence_id" },
    )
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function removePattern(id: string) {
  const { error } = await createClient().from("saved_patterns").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type Rating = "got-it" | "again";

/**
 * Moves a pattern up the ladder, or resets it to box 1 and due immediately.
 *
 * The box is clamped by `daysUntilNextReview` reading the ladder, so a learner who keeps
 * saying "Got it" settles at box 6 and a 16-day wait rather than running off the end.
 */
export async function ratePattern(id: string, rating: Rating) {
  const userId = currentUserId();
  if (!userId) throw new Error("Sign in to rate a pattern.");

  const supabase = createClient();

  const { data: current, error: readError } = await supabase
    .from("saved_patterns")
    .select("box")
    .eq("id", id)
    .maybeSingle();

  if (readError) throw new Error(readError.message);
  if (!current) throw new Error("That pattern is no longer saved.");

  const gotIt = rating === "got-it";
  const box = gotIt ? Math.min(current.box + 1, MAX_BOX) : 1;
  const nextReviewAt = new Date(
    Date.now() + (gotIt ? daysUntilNextReview(current.box) * DAY_MS : 0),
  ).toISOString();

  const { error } = await supabase
    .from("saved_patterns")
    // Scoped to the owner as well as relying on RLS, so a loosened policy could never let
    // one learner move another's progress.
    .update({ box, next_review_at: nextReviewAt })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
  return { box, nextReviewAt };
}