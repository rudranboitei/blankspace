/**
 * Checks the committed bank without a model call: shape, ids, duplicates, and the two
 * invariants the matcher leans on. Run it before shipping a bank you have edited by hand.
 *
 *   bun run bank:validate
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TOPICS } from "../src/lib/topics";
import { bankSchema, type BankItem } from "../src/lib/schema";
import { normalizeAnswer, plainPhrase } from "../src/lib/normalize";
import { finalizePhrase, unnestPattern } from "../src/lib/bank-item";
import { slotCount } from "../src/lib/slots";

const BANK_DIR = join(process.cwd(), "src", "data", "bank");

/**
 * Rewrites every item's correctPhrase the same way the generator does. The model left most
 * of them unbraced, and the slots are the point of the app, so this is how an existing bank
 * gets repaired without spending another run's worth of calls.
 */
const shouldFix = process.argv.includes("--fix");
let fixed = 0;

let problems = 0;
let warnings = 0;

/** A fault: the file breaks an invariant the matcher depends on. */
function problem(file: string, message: string) {
  problems++;
  console.log(`  ! ${file}: ${message}`);
}

/** A quality note: still usable, but it makes the matcher stricter than it needs to be. */
function warn(file: string, message: string) {
  warnings++;
  console.log(`  - ${file}: ${message}`);
}

let total = 0;

for (const topic of TOPICS) {
  const path = join(BANK_DIR, `${topic}.json`);
  console.log(`\n${topic}`);

  if (!existsSync(path)) {
    problem(`${topic}.json`, "missing. Run bun run bank:generate");
    continue;
  }

  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const result = bankSchema.safeParse(parsed);
  if (!result.success) {
    problem(`${topic}.json`, `does not match the schema: ${result.error.issues[0]?.message}`);
    continue;
  }

  const items = result.data;
  total += items.length;
  console.log(`  ${items.length} items`);

  const ids = new Set<string>();
  const hindiSeen = new Map<string, string>();

  items.forEach((item, index) => {
    const where = `${item.id} (#${index + 1})`;

    if (item.topic !== topic) problem(`${topic}.json`, `${where} has topic "${item.topic}"`);
    if (ids.has(item.id)) problem(`${topic}.json`, `${where} repeats an id`);
    ids.add(item.id);

    const hindiKey = normalizeAnswer(item.hindi);
    const previous = hindiSeen.get(hindiKey);
    if (previous) problem(`${topic}.json`, `${where} repeats the Hindi of ${previous}`);
    hindiSeen.set(hindiKey, where);

    // The matcher only ever calls an answer right if it is in this list, so an item with a
    // thin one is a trap rather than a gap.
    if (item.accepted.length < 3) {
      warn(`${topic}.json`, `${where} lists only ${item.accepted.length} accepted wording(s)`);
    }

    const normalizedAccepted = item.accepted.map(normalizeAnswer);
    if (new Set(normalizedAccepted).size !== normalizedAccepted.length) {
      problem(`${topic}.json`, `${where} has accepted wordings that collapse to the same thing`);
    }

    const slots = slotCount(item.pattern);
    if (slots < 2) problem(`${topic}.json`, `${where} pattern has ${slots} slot(s), wants 2 or 3`);

    if (/\{[^{}]*\{/.test(item.pattern)) {
      if (unnestPattern(item.pattern) !== item.pattern) {
        if (shouldFix) {
          item.pattern = unnestPattern(item.pattern);
          fixed++;
        } else {
          problem(`${topic}.json`, `${where} nests braces in the pattern. Run with --fix`);
        }
      }
    }

    // The brace-free phrase has to be one of the accepted wordings, or a learner who
    // copies the thing the app taught gets marked wrong.
    const plain = normalizeAnswer(plainPhrase(item.correctPhrase));
    if (!normalizedAccepted.includes(plain)) {
      problem(
        `${topic}.json`,
        `${where} phrase "${plainPhrase(item.correctPhrase)}" is not in its accepted list`,
      );
    }

    const wanted = finalizePhrase(item.accepted, item.pattern, item.correctPhrase);
    if (wanted.phrase !== item.correctPhrase) {
      if (shouldFix) {
        item.correctPhrase = wanted.phrase;
        fixed++;
      } else {
        problem(
          `${topic}.json`,
          `${where} phrase is not the best slotted wording. Run with --fix, or set it to "${wanted.phrase}"`,
        );
      }
    }

    if (item.variations.some((variation) => /[{}]/.test(variation))) {
      problem(`${topic}.json`, `${where} has braces in a variation`);
    }
  });
}

if (shouldFix && fixed > 0) {
  for (const topic of TOPICS) {
    const path = join(BANK_DIR, `${topic}.json`);
    if (!existsSync(path)) continue;
    const items = JSON.parse(readFileSync(path, "utf8")) as BankItem[];
    const repaired = items.map((item) => {
      // The pattern first: slotizing needs an un-nested skeleton to line up against.
      const pattern = unnestPattern(item.pattern);
      return { ...item, pattern, correctPhrase: finalizePhrase(item.accepted, pattern, item.correctPhrase).phrase };
    });
    writeFileSync(path, `${JSON.stringify(repaired, null, 2)}\n`);
  }
  console.log(`\nfixed ${fixed} phrase(s)`);
}

console.log(`\n${total} items across ${TOPICS.length} topics`);
if (warnings > 0) console.log(`${warnings} quality note(s)`);
if (problems > 0) {
  console.log(`${problems} problem(s) found`);
  process.exit(1);
}
console.log("shape and invariants pass. Content still needs a human read.");