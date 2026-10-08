"use client";

import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/session";
import type { Verdict } from "@/lib/match";

/**
 * Records one graded answer.
 *
 * `user_id` is left out so the column default stamps it, and a guest is skipped rather than
 * firing a request that is certain to be refused: with no session `auth.uid()` is null and
 * the RLS policy is scoped to `authenticated`.
 *
 * Nothing here may interrupt practising, so a failed log is logged and forgotten. The learner
 * already has their answer.
 */
export function logAttempt(input: {
  sentenceId: string;
  userAnswer: string;
  verdict: Verdict;
}) {
  if (!currentUserId()) return;

  void createClient()
    .from("attempts")
    .insert({
      sentence_id: input.sentenceId,
      user_answer: input.userAnswer,
      result: input.verdict,
    })
    .then(({ error }) => {
      if (error) console.error("[attempts] could not log:", error.message);
    });
}