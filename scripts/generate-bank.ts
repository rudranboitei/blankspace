/**
 * One-time builder for the practice bank. Every item it writes becomes a file that the
 * app reads from disk, so after this has run once the practice screen makes no model call
 * at all.
 *
 *   bun run bank:generate                     # 50 per topic, top up what is missing
 *   bun run bank:generate -- --topic tech-work --count 20
 *
 * It appends to whatever is already committed, skips duplicate Hindi sentences, and writes
 * after every batch so an interrupted run still leaves usable data behind.
 *
 * Everything it produces is a DRAFT. Read it before shipping: a phrase that reads well but
 * is not how a native speaker would say it teaches the wrong thing, and the learner has no
 * way to tell. `bun run bank:validate` checks the shape and the id scheme.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { askForJson, toCoachError } from "../src/lib/groq-client";
import { loadEnv } from "./lib/load-env";
import { TOPICS, TOPIC_BRIEFS, type Topic } from "../src/lib/topics";
import { bankDraftSchema, bankItemSchema, bankSchema, type BankDraft } from "../src/lib/schema";
import { normalizeAnswer, plainPhrase } from "../src/lib/normalize";
import { acceptedForms } from "../src/lib/match";
import { finalizePhrase } from "../src/lib/bank-item";
import { slotCount } from "../src/lib/slots";

/** `bun run` always starts in the package root, which is all this needs. */
loadEnv();

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "src", "data", "bank");

/** Short prefix per topic, so an id reads at a glance: tw-014, dl-007, iv-021. */
const PREFIX: Record<Topic, string> = {
  "tech-work": "tw",
  "daily-life": "dl",
  interview: "iv",
};

const DEFAULT_PER_TOPIC = 50;
const PER_CALL = 4;
/** The free tier is 8000 tokens a minute, so a batch has to be paced rather than fired. */
const GAP_MS = 20_000;
/** Give up on a topic rather than spin: the model has run out of fresh situations. */
const MAX_BARREN_BATCHES = 6;

const SYSTEM_PROMPT = `You build a practice bank for an English phrase app used by Hindi speakers. Each item is one romanized Hindi situation and the natural English phrase pattern behind it.

Rules for every item:
- hindi: Romanized Hindi in Latin script only, never Devanagari. 6 to 14 words, one everyday spoken sentence.
- The situation must have a clear, reusable English phrase pattern. Not a sentence that only works word for word.
- accepted: 3 to 5 different English sentences a native speaker would genuinely accept as correct for this Hindi sentence. Cover the wordings learners actually produce, including a shorter and a longer phrasing of the same idea. This list is what stops a right answer being marked wrong, so be generous but do not add anything that changes the meaning.
- correctPhrase: one natural spoken English sentence for the situation. Wrap 2 or 3 swappable parts in braces, each 1 to 4 words. It must be one of the wordings in accepted, written out without the braces.
- pattern: the same frame with generic slots, more general than correctPhrase. Slot labels are short and generic, never words lifted from the sentence. Never nest braces.
- variations: 1 to 2 more plain sentences that reuse the same frame with different fillers. No braces, no labels.
- No names, numbers, dates or company-specific details.
- Every item is a different situation. Do not repeat an idea.

Return one JSON object and nothing else. Shape: {"items":[{"hindi":"...","accepted":["...","..."],"correctPhrase":"...","pattern":"...","variations":["..."]}]}`;

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function bankPath(topic: Topic) {
  return join(OUT_DIR, `${topic}.json`);
}

function readExisting(topic: Topic) {
  const path = bankPath(topic);
  if (!existsSync(path)) return [];

  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const result = bankSchema.safeParse(parsed);
  if (!result.success) {
    console.error(`[bank] ${path} is not a valid bank, refusing to extend it:`);
    console.error(result.error.issues.slice(0, 5));
    process.exit(1);
  }
  return result.data;
}

/**
 * Turns one model reply into a committable item, or explains why it cannot be.
 *
 * The accepted list is deduped rather than rejected: models routinely give the same wording
 * twice with different casing or punctuation, and once normalised those are one entry.
 * Rejecting over it would throw away an otherwise good item, and it is the reason an
 * earlier run burned fifty batches to keep five.
 */
function sanitize(
  draft: BankDraft["items"][number],
  topic: Topic,
  id: string,
  seen: Set<string>,
) {
  if (seen.has(normalizeAnswer(draft.hindi))) {
    return { ok: false as const, reason: "duplicate sentence" };
  }

  // The phrase on its own is an accepted wording, so a learner who copies what the app
  // taught is never marked down for it.
  const deduped: string[] = [];
  const forms: string[] = [];
  for (const form of [...draft.accepted, plainPhrase(draft.correctPhrase)]) {
    const normalized = normalizeAnswer(form);
    if (normalized === "" || forms.includes(normalized)) continue;
    forms.push(normalized);
    deduped.push(form.trim());
  }

  if (forms.length < 2) return { ok: false as const, reason: "fewer than two distinct wordings" };
  if (seen.has(forms[forms.length - 1])) return { ok: false as const, reason: "duplicate phrase" };

  // The model does not reliably brace the phrase, so it is settled here instead: pick the
  // accepted wording that reads best as a pattern, then slot it against the skeleton.
  const { phrase } = finalizePhrase(deduped, draft.pattern, draft.correctPhrase);

  const candidate = bankItemSchema.safeParse({
    hindi: draft.hindi,
    accepted: deduped,
    correctPhrase: phrase,
    pattern: draft.pattern,
    variations: draft.variations,
    id,
    topic,
  });
  if (!candidate.success) {
    return { ok: false as const, reason: candidate.error.issues[0]?.message ?? "shape" };
  }

  // A pattern wrapped in one outer brace nests every slot inside it and cannot be read.
  if (/\{[^{}]*\{[^{}]*\}[^{}]*\}/.test(candidate.data.pattern)) {
    return { ok: false as const, reason: "pattern nests braces" };
  }

  if (slotCount(candidate.data.pattern) < 2) {
    return { ok: false as const, reason: "pattern has fewer than two slots" };
  }

  // A generic label should not carry a content word lifted straight out of the sentence.
  const slotWords = new Set(
    (candidate.data.pattern.match(/\{([^{}]+)\}/g) ?? []).flatMap((slot) =>
      slot.replace(/[{}]/g, "").split(" "),
    ),
  );
  const lifted = [...slotWords].filter((slotWord) => {
    const clean = normalizeAnswer(slotWord);
    return clean.length > 4 && forms.includes(clean);
  });
  if (lifted.length > 0) {
    return { ok: false as const, reason: `pattern slot reuses a sentence word: ${lifted.join(", ")}` };
  }

  return { ok: true as const, item: candidate.data, forms };
}

/** Most rejections repeat themselves; one line of counts beats one line per item. */
function summarise(reasons: string[]) {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => (n > 1 ? `${reason} x${n}` : reason)).join(", ");
}

async function generateBatch(topic: Topic, wanted: number) {
  const { items } = await askForJson({
    system: SYSTEM_PROMPT,
    user: `Topic: ${TOPIC_BRIEFS[topic]}\n\nWrite ${wanted} different practice items for this topic, as one JSON object.`,
    schema: bankDraftSchema,
    maxTokens: 3000,
    temperature: 1,
    retrySuffix:
      "\n\nYour previous reply was not usable. Send only the JSON object, with the keys items, hindi, accepted, correctPhrase, pattern and variations, and nothing around it.",
  });
  return items;
}

async function runTopic(topic: Topic, target: number) {
  const existing = readExisting(topic);
  const seen = new Set<string>();
  for (const item of existing) {
    seen.add(normalizeAnswer(item.hindi));
    for (const form of acceptedForms(item)) seen.add(normalizeAnswer(form));
  }

  const items = [...existing];
  console.log(`[bank] ${topic}: ${existing.length} committed, aiming for ${target}`);

  let batch = 0;
  let barren = 0;

  while (items.length < target) {
    if (barren >= MAX_BARREN_BATCHES) {
      console.log(`\n[bank] ${topic}: ${barren} batches produced nothing new, stopping`);
      break;
    }

    const wanted = Math.min(PER_CALL, target - items.length);
    batch++;
    process.stdout.write(`[bank] ${topic}: batch ${batch} (${items.length}/${target}) `);

    let drafts: Awaited<ReturnType<typeof generateBatch>>;
    try {
      drafts = await generateBatch(topic, wanted);
    } catch (error) {
      const coachError = toCoachError(error);
      if (coachError.code === "rate_limited") {
        console.log("rate limited, backing off");
        barren++;
        await new Promise((resolve) => setTimeout(resolve, 45_000));
        continue;
      }
      // A truncated or misshapen reply is a model hiccup, not a reason to abandon a topic.
      if (coachError.code === "bad_model_reply") {
        console.log(`retrying after: ${coachError.message}`);
        barren++;
        await new Promise((resolve) => setTimeout(resolve, GAP_MS));
        continue;
      }
      console.log(`\n[bank] ${topic}: giving up this run (${coachError.message})`);
      break;
    }

    const rejected: string[] = [];
    for (const draft of drafts) {
      if (items.length >= target) break;

      const id = `${PREFIX[topic]}-${String(items.length + 1).padStart(3, "0")}`;
      const outcome = sanitize(draft, topic, id, seen);

      if (!outcome.ok) {
        rejected.push(outcome.reason);
        continue;
      }

      seen.add(normalizeAnswer(outcome.item.hindi));
      for (const form of outcome.forms) seen.add(form);
      items.push(outcome.item);
    }

    writeFileSync(bankPath(topic), `${JSON.stringify(items, null, 2)}\n`);
    const kept = drafts.length - rejected.length;

    barren = kept === 0 ? barren + 1 : 0;
    const reasons = rejected.length ? ` (${summarise(rejected)})` : "";
    console.log(`+ ${kept}/${drafts.length} kept, ${items.length} total${reasons}`);
  }

  return items;
}

async function main() {
  const only = arg("topic") as Topic | undefined;
  if (only && !TOPICS.includes(only)) {
    console.error(`--topic must be one of ${TOPICS.join(", ")}`);
    process.exit(1);
  }

  const target = Number(arg("count", String(DEFAULT_PER_TOPIC)));
  const topics = only ? [only] : [...TOPICS];

  mkdirSync(OUT_DIR, { recursive: true });

  for (const topic of topics) {
    const items = await runTopic(topic, target);
    console.log(`[bank] ${topic}: done with ${items.length}\n`);
    if (topic !== topics[topics.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }
  }

  console.log("[bank] all done. These are DRAFTS: read them before shipping.");
}

main().catch((error) => {
  console.error("[bank] failed:", error);
  process.exit(1);
});