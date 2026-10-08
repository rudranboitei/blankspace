import { askForJson, errorResponse } from "@/lib/groq";
import {
  EXPLAIN_RETRY_SUFFIX,
  EXPLAIN_SYSTEM_PROMPT,
  explainUserPrompt,
  VERIFY_SYSTEM_PROMPT,
  verifyUserPrompt,
} from "@/lib/prompts";
import { explainReplySchema, explainRequestSchema, verifyReplySchema } from "@/lib/schema";
import { normalizeAnswer } from "@/lib/normalize";
import { consumeCoachQuota } from "@/lib/rate-limit";
import { createAdminClient, answerHash } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { TOPIC_BRIEFS, type Topic } from "@/lib/topics";

/**
 * The only route that spends money. Sentences and verdicts are settled on the device from
 * the `sentences` table, so this is reached for only when a learner deliberately asks.
 *
 * The reply is cached in `explanations`, keyed by the sentence and a hash of the normalised
 * answer, so the same question is never paid for twice, on any device.
 *
 * The request carries a sentence id and an answer, never the sentence itself or a cache key:
 * the server looks the sentence up and derives the key, so a caller cannot coach a different
 * sentence than the one they are looking at or read another learner's cache entry.
 *
 * Signing in is not required, and nothing here reads anything belonging to the caller. What
 * keeps that from being a way to spend freely is the cache above and the quota below.
 */
export async function POST(request: Request) {
  // Proxy skips /api so this answers with JSON instead of a redirect to the login page.
  //
  // Guests are allowed: the coach works signed out, the answer is cached on the sentence
  // rather than on the caller, so a guest costs the same as anyone else and often less,
  // because the cache is shared. They are limited per address instead of per account.
  const userClient = await createClient();

  // Read the JWT rather than asking the auth server who this is. `getUser` would spend a
  // round trip on every request to learn something the cookie already says.
  const { data: claims } = await userClient.auth.getClaims();
  const userId = claims?.claims.sub ?? null;

  const body = await request.json().catch(() => null);
  const parsed = explainRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Write your English version first.", code: "bad_request" },
      { status: 400 },
    );
  }

  const { sentenceId, answer, mode } = parsed.data;

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    return errorResponse(error);
  }

  try {
    // RLS lets the user's own client read approved sentences, so no privileged read is
    // needed to look one up.
    const { data: sentence, error: sentenceError } = await userClient
      .from("sentences")
      .select("id, topic, hindi, accepted, correct_phrase, pattern")
      .eq("id", sentenceId)
      .maybeSingle();

    if (sentenceError) throw new Error(sentenceError.message);
    if (!sentence) {
      return Response.json(
        { error: "That sentence is no longer available.", code: "not_found" },
        { status: 404 },
      );
    }

    const normalized = normalizeAnswer(answer);
    if (normalized === "") {
      return Response.json(
        { error: "Write your English version first.", code: "bad_request" },
        { status: 400 },
      );
    }

    const hash = answerHash(mode, normalized);

    const { data: cached, error: cacheError } = await admin
      .from("explanations")
      .select("content")
      .eq("sentence_id", sentenceId)
      .eq("answer_hash", hash)
      .maybeSingle();

    if (cacheError) throw new Error(cacheError.message);
    if (cached) return Response.json({ kind: mode, cached: true, ...cached.content });

    // Everything above was free. This is the first point where a call would cost anything,
    // so this is the only place worth spending quota, and a cache hit above is never charged.
    const quota = await consumeCoachQuota({ admin, userId, request });
    if (!quota.allowed) {
      // A distinct code from the provider's own 429, which is also `rate_limited`. Both are a
      // 429 to the caller, but only one of them is this learner's allowance, and only one of
      // them will be back after a minute rather than after Groq's backoff runs out.
      return Response.json(
        { error: quota.message, code: "out_of_allowance" },
        { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds) } },
      );
    }

    const topicBrief = TOPIC_BRIEFS[sentence.topic as Topic] ?? sentence.topic;

    // Two questions, two shapes. Asking explain for a verdict it has no business
    // answering is what made the model invent one.
    const reply =
      mode === "verify"
        ? await askForJson({
            system: VERIFY_SYSTEM_PROMPT,
            user: verifyUserPrompt({
              topicBrief,
              hindi: sentence.hindi,
              userAnswer: answer,
            }),
            schema: verifyReplySchema,
            maxTokens: 300,
            temperature: 0.2,
            retrySuffix: EXPLAIN_RETRY_SUFFIX,
          })
        : await askForJson({
            system: EXPLAIN_SYSTEM_PROMPT,
            user: explainUserPrompt({
              topicBrief,
              hindi: sentence.hindi,
              userAnswer: answer,
            }),
            schema: explainReplySchema,
            maxTokens: 900,
            temperature: 0.4,
            retrySuffix: EXPLAIN_RETRY_SUFFIX,
          });

    // Upsert rather than insert: two clicks a moment apart would otherwise collide on the
    // unique key, and losing the cache is a far smaller problem than a 500.
    const { error: writeError } = await admin.from("explanations").upsert(
      { sentence_id: sentenceId, answer_hash: hash, content: reply },
      { onConflict: "sentence_id,answer_hash" },
    );
    if (writeError) {
      // The learner still gets their answer even if the cache could not be written.
      console.error("[explain] could not cache:", writeError.message);
    }

    return Response.json({ kind: mode, cached: false, ...reply });
  } catch (error) {
    return errorResponse(error);
  }
}