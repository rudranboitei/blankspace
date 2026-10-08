import { normalizeAnswer, plainPhrase } from "@/lib/normalize";
import { slotCount, slotize } from "@/lib/slots";

/**
 * Settles an item's `correctPhrase`.
 *
 * Two things happen here, in this order, because they pull against each other:
 *
 *  1. `correctPhrase` is picked from the accepted list, preferring the wording that slots
 *     best. The phrase has to be one of the accepted wordings or a learner who copies what
 *     the app taught gets marked wrong, so it is chosen rather than invented.
 *  2. The winner is passed through `slotize`, which marks the swappable parts using the
 *     pattern as a skeleton.
 *
 * `gpt-oss-20b` will not reliably wrap the phrase in braces itself, so step 2 is not a
 * fallback, it is the only reason the slots are there.
 */
export function finalizePhrase(
  accepted: string[],
  pattern: string,
  preferred?: string,
): { phrase: string; slots: number } {
  const candidates = [...new Set(accepted.map((form) => form.trim()).filter(Boolean))];
  if (candidates.length === 0) return { phrase: "", slots: 0 };

  // The generator's own choice goes first, so a model that wrote a good phrase keeps it.
  // Compared on the plain form, otherwise a phrase that has already been slotted fails to
  // match its own candidate and running this twice picks a different winner.
  if (preferred) {
    const wanted = normalizeAnswer(plainPhrase(preferred));
    const index = candidates.findIndex(
      (form) => normalizeAnswer(plainPhrase(form)) === wanted,
    );
    if (index > 0) {
      candidates.unshift(...candidates.splice(index, 1));
    }
  }

  // `best` keeps the plain candidate alongside the slotted phrase: comparing a plain
  // candidate's length against a slotted phrase biases the tiebreak, which made this return
  // a different answer on a second run over the same item.
  let best = { candidate: "", phrase: "", slots: -1 };

  for (const form of candidates) {
    const slotted = slotize(form, pattern);
    const slots = slotCount(slotted);

    // Only adopt a slotted form when it keeps every word, so nothing is ever lost.
    if (slots > 0 && slotted.replace(/[{}]/g, "") !== form) continue;

    const phrase = slots > 0 ? slotted : form;
    const better =
      slots > best.slots || (slots === best.slots && form.length < best.candidate.length);
    if (better) best = { candidate: form, phrase, slots };
  }

  return best.slots >= 0 ? best : { phrase: candidates[0], slots: slotCount(candidates[0]) };
}
/**
 * The model sometimes wraps the entire pattern in one pair of braces, which nests every
 * slot inside it. The outer pair is always wrong: removing it leaves a usable pattern.
 */
export function unnestPattern(pattern: string) {
  const trimmed = pattern.trim();
  if (!/^\{[^{}]*\{[^{}]*\}[^{}]*\}$/.test(trimmed)) return pattern;
  return trimmed.slice(1, -1).trim();
}
