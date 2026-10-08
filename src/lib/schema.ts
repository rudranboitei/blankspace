import { z } from "zod";

import { tidySlots } from "@/lib/slots";
import { TOPICS } from "@/lib/topics";

/** Devanagari shows up when a small model slips into native script. */
const latinOnly = (label: string) =>
  z.string().trim().min(1).max(300).refine((text) => !/[ऀ-ॿ]/.test(text), {
    message: `${label} must be romanized, not Devanagari.`,
  });

export const topicSchema = z.enum(TOPICS);

/**
 * One practice item. The app never asks a model for these, it only reads them, which is
 * why `accepted` carries the weight: it is the set of wordings that count as fully right,
 * so a correct answer in any of them is "correct" with no request made.
 *
 * `id` and `topic` are stamped by `scripts/generate-bank.ts`, never by the model, so they
 * cannot collide or drift.
 */
export const bankItemSchema = z.object({
  id: z.string().regex(/^[a-z]{2}-\d{3}$/, "id must look like tw-014"),
  topic: topicSchema,
  hindi: latinOnly("hindi"),
  accepted: z.array(z.string().trim().min(1).max(300)).min(2, "Give at least two accepted wordings."),
  correctPhrase: z.string().trim().min(1).max(300),
  pattern: z.string().trim().min(1).max(300),
  variations: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
});

export const bankSchema = z.array(bankItemSchema);

/**
 * What the model is asked for. `id` and `topic` are added afterwards, so a reply that
 * invents them is simply ignored rather than trusted.
 */
export const bankDraftSchema = z.object({
  items: z
    .array(
      z.object({
        hindi: latinOnly("hindi"),
        accepted: z
          .array(z.string().trim().min(1).max(300))
          .min(2, "Give at least two accepted wordings."),
        correctPhrase: z.string().trim().min(1).max(300),
        pattern: z.string().trim().min(1).max(300),
        variations: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
      }),
    )
    .min(1),
});

/** Body of POST /api/explain */
export const explainRequestSchema = z.object({
  /** The server looks the sentence up, so a caller cannot coach a different one. */
  sentenceId: z.string().trim().min(1).max(40),
  answer: z.string().trim().min(1).max(600),
  /** "explain" fills in the coaching. "verify" asks whether an unusual answer was right. */
  mode: z.enum(["explain", "verify"]),
});

/**
 * The one a learner can always afford to see: the coached phrase and the pattern, tidied so
 * nothing renders or reads out a separator the model invented.
 */
const slotted = z.string().trim().max(300).transform(tidySlots);

/**
 * The two coach replies answer different questions, so they have different shapes.
 *
 * `explain` never returns a verdict, because the bank already decided that on the device;
 * asking for one just invited the model to invent a value. `verify` is the only reply that
 * carries one. Every field defaults, because gpt-oss-20b drops keys often and a missing line
 * of copy is cheaper than losing the whole reply.
 */
export const explainReplySchema = z.object({
  correctPhrase: slotted.default(""),
  pattern: slotted.default(""),
  variations: z.array(z.string().trim().max(300)).max(3).default([]),
  note: z.string().trim().max(300).default(""),
});

export const verifyReplySchema = z.object({
  verdict: z.enum(["correct", "needs-work"]),
  note: z.string().trim().max(300).default(""),
});

export type ExplainReply = z.infer<typeof explainReplySchema> & { kind: "explain" };
export type VerifyReply = z.infer<typeof verifyReplySchema> & { kind: "verify" };
export type CoachReply = ExplainReply | VerifyReply;

export type BankItem = z.infer<typeof bankItemSchema>;
export type BankDraft = z.infer<typeof bankDraftSchema>;
export type ExplainRequest = z.infer<typeof explainRequestSchema>;