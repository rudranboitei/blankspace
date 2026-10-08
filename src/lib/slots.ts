import { normalizeAnswer } from "@/lib/normalize";

/**
 * Works out where the swappable parts of a phrase are, using the pattern's fixed words as
 * anchors.
 *
 * This exists because `gpt-oss-20b` will not reliably wrap `correctPhrase` in braces, and
 * the slots are the whole point of the app. Rather than hope the model complies, the pattern
 * is treated as a skeleton: its unbraced words must appear in the phrase, in order, and
 * whatever falls between them is what the learner fills in.
 *
 *   pattern: "After {doing something}, I need to {do the next thing}."
 *   phrase:  "After learning React, I need to learn AI."
 *   result:  "After {learning React}, I need to {learn AI}."
 *
 * Returns the phrase unchanged when it cannot be aligned, which leaves a plain sentence
 * rather than a mangled one.
 */
export function slotize(phrase: string, pattern: string) {
  // Already slotted, so there is nothing left to work out. Without this, running twice would
  // nest the braces: "{a}" becomes "{{a}}".
  if (slotCount(phrase) > 0) return phrase;

  const anchors: string[] = [];
  // The slots have to come out before tokenising, otherwise splitting on whitespace breaks
  // "{doing something}" across two tokens and both halves become bogus anchors.
  const skeleton = pattern.replace(/\{[^{}]*\}/g, " ");

  for (const token of skeleton.split(/\s+/)) {
    const normalized = normalizeAnswer(token);
    // Punctuation alone carries no anchor: a bare comma or full stop would match too much.
    if (normalized === "" || !/[a-z0-9]/.test(normalized)) continue;
    anchors.push(normalized);
  }

  const words = phrase.split(/\s+/).filter((word) => word !== "");
  if (anchors.length === 0 || words.length === 0) return phrase;

  const out: string[] = [];
  let gap: string[] = [];

  // Trailing punctuation belongs outside the braces, so "learn AI." slots as {learn AI}.
  const flushGap = () => {
    if (gap.length === 0) return;

    const words = [...gap];
    const last = words[words.length - 1];
    // Only the punctuation is lifted out: "React," is a word with a comma on it, not a comma.
    const trailing = last.match(/[.,!?;:)]+$/)?.[0] ?? "";
    if (trailing) words[words.length - 1] = last.slice(0, -trailing.length);

    if (words.length > 0) out.push(`{${words.join(" ")}}${trailing}`);
    else out.push(trailing);

    gap = [];
  };

  let anchorIndex = 0;
  let slots = 0;

  for (const word of words) {
    const key = normalizeAnswer(word).replace(/[^a-z0-9]/g, "");

    if (anchorIndex < anchors.length && key === anchors[anchorIndex]) {
      if (gap.length > 0) slots++;
      flushGap();
      // The anchor itself is part of the phrase and has to be written back out.
      out.push(word);
      anchorIndex++;
      continue;
    }
    gap.push(word);
  }
  if (gap.length > 0) slots++;
  flushGap();

  // Not enough of the pattern lined up to be sure of the cut, so a plain sentence is
  // safer than a phrase with a slot in the wrong place.
  if (anchorIndex === 0 || slots < 2) return phrase;

  return out.join(" ").replace(/\s+([.,!?;:])/g, "$1").replace(/\s+/g, " ").trim();
}

/**
 * Tidy up a phrase or pattern the model wrote before it reaches the UI:
 *
 *  - it sometimes writes a slot as an alternation, `{help me|assist me}`, as though the
 *    braces were a regex. Rendered, and worse spoken aloud, the pipe reads as a word, so the
 *    first option wins.
 *  - it sometimes leaves a space before punctuation, `{the deadline} ,`, which shows up as a
 *    gap in the sentence.
 */
export function tidySlots(text: string) {
  return collapseAlternatives(text).replace(/\s+([.,!?;:])/g, "$1");
}

/** How many `{...}` slots a string carries. */
export function slotCount(text: string) {
  return (text.match(/\{[^{}]*\}/g) ?? []).length;
}

function collapseAlternatives(text: string) {
  return text.replace(/\{([^{}|]*)\|[^{}]*\}/g, (_match, first: string) => `{${first.trim()}}`);
}