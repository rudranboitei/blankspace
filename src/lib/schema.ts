import { z } from "zod";

import { TOPICS } from "@/lib/topics";

/** Devanagari shows up when a small model slips into native script. */
const latinOnly = (label: string) =>
  z.string().trim().min(1).max(300).refine((text) => !/[ऀ-ॿ]/.test(text), {
    message: `${label} must be romanized, not Devanagari.`,
  });

export const topicSchema = z.enum(TOPICS);

/** Body of POST /api/sentence */
export const sentenceRequestSchema = z.object({
  topic: topicSchema,
});

/** Response of POST /api/sentence */
export const sentenceResponseSchema = z.object({
  sentence: latinOnly("sentence"),
});

/** Body of POST /api/check */
export const checkRequestSchema = z.object({
  topic: topicSchema,
  hindi: z.string().trim().min(1, "Missing the Hindi sentence.").max(400),
  userAnswer: z.string().trim().min(1, "Type or speak your English version first.").max(600),
});

/**
 * The contract the UI renders: two exact variations, braces mark swappable slots.
 */
export const feedbackSchema = z.object({
  correctPhrase: z.string().trim().min(1).max(300),
  pattern: z.string().trim().min(1).max(300),
  variations: z.tuple([z.string().trim().min(1).max(300), z.string().trim().min(1).max(300)]),
  note: latinOnly("note"),
});

export type Feedback = z.infer<typeof feedbackSchema>;
export type SentenceResponse = z.infer<typeof sentenceResponseSchema>;