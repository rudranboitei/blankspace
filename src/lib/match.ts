import { diffWords } from "diff";

import { answerTokens, normalizeAnswer, plainPhrase } from "@/lib/normalize";
import type { BankItem } from "@/lib/schema";

export type { BankItem };

export type Verdict = "correct" | "almost" | "wrong";

/** From here up an answer is close enough that it should be called almost right. */
export const ALMOST_AT = 0.85;

export type Match = {
  verdict: Verdict;
  /** 1 when the normalised answer matched an accepted form exactly. */
  similarity: number;
  /** The accepted form it was measured against, for the diff. */
  reference: string;
};

/**
 * Levenshtein over words rather than letters. An extra "too" at the end of a nine-word
 * sentence should read as almost right, which a letter-level ratio badly understates,
 * while a transposed clause should not.
 */
export function tokenSimilarity(left: string[], right: string[]) {
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  let current = new Array<number>(right.length + 1);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const substitution = previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    [previous, current] = [current, previous];
  }

  const distance = previous[right.length];
  return 1 - distance / Math.max(left.length, right.length);
}

/** Every wording this item counts as fully right, the preset phrase included. */
export function acceptedForms(item: BankItem) {
  return [...item.accepted, plainPhrase(item.correctPhrase)];
}

/**
 * Judges an answer entirely on this device. No request, no cost, no rate limit: the
 * worst case is a wording the bank does not list being called wrong, which is what the
 * "my answer is right" button is there for.
 */
export function matchAnswer(answer: string, item: BankItem): Match {
  const tokens = answerTokens(answer);
  const normalized = normalizeAnswer(answer);

  if (tokens.length === 0) {
    return { verdict: "wrong", similarity: 0, reference: acceptedForms(item)[0] };
  }

  let best = { similarity: 0, reference: acceptedForms(item)[0] };

  for (const form of acceptedForms(item)) {
    const candidate = normalizeAnswer(form);
    if (candidate === normalized) {
      return { verdict: "correct", similarity: 1, reference: form };
    }

    const similarity = tokenSimilarity(tokens, answerTokens(form));
    if (similarity > best.similarity) {
      best = { similarity, reference: form };
    }
  }

  return {
    verdict: best.similarity >= ALMOST_AT ? "almost" : "wrong",
    similarity: best.similarity,
    reference: best.reference,
  };
}

export type DiffWord = { text: string; kind: "same" | "extra" | "missing" };

/**
 * Which words the learner got wrong, and which they left out, measured against the phrase
 * the bank would have said. `extra` is theirs to fix, `missing` is what was owed.
 */
export function diffAnswer(answer: string, reference: string): DiffWord[] {
  const changes = diffWords(plainPhrase(answer), plainPhrase(reference));

  return changes.map((change) => {
    const trimmed = change.value.trim();
    if (!trimmed) return null;

    if (change.added) return { text: trimmed, kind: "missing" as const };
    if (change.removed) return { text: trimmed, kind: "extra" as const };
    return { text: trimmed, kind: "same" as const };
  }).filter((word): word is DiffWord => word !== null);
}

/** The opening words of the phrase, used for the Hint button. Local, so it is free. */
export function hintFor(item: BankItem, words = 3) {
  return answerTokens(plainPhrase(item.correctPhrase)).slice(0, words).join(" ");
}