/**
 * Loads the committed JSON bank into the `sentences` table.
 *
 *   bun run seed              # validate, dedupe, upsert
 *   bun run seed -- --dry-run # everything except the upsert, so you can read it first
 *   bun run seed -- --topic tech-work
 *
 * Safe to run as many times as you like. Rows are matched on `id`, and only the columns
 * that come from the JSON are written: `status` and `difficulty` are left alone so that
 * re-seeding can never undo a reviewer's work.
 *
 * Needs `SUPABASE_SERVICE_ROLE_KEY`, server side only. It is read from the environment here
 * and never leaves this process.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { loadEnv } from "./lib/load-env";
import { normalizeAnswer } from "../src/lib/normalize";
import { bankItemSchema, type BankItem } from "../src/lib/schema";
import { TOPICS, type Topic } from "../src/lib/topics";

// Next.js loads .env.local; a bare `bun run` does not. Without this the script sees an
// empty environment and stops with a missing-key error even though the key is sitting
// right there in .env.local.
loadEnv();

const BANK_DIR = join(process.cwd(), "src", "data", "bank");
const BATCH_SIZE = 100;

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const dryRun = process.argv.includes("--dry-run");

/** The columns the JSON owns. `status`, `difficulty` and `created_at` are not in here. */
type Row = {
  id: string;
  topic: string;
  hindi: string;
  accepted: string[];
  correct_phrase: string;
  pattern: string;
  variations: string[];
};

function envValue(name: string) {
  return process.env[name]?.trim() ?? "";
}

/**
 * `sentences` uses snake_case, the JSON uses the camelCase the components already speak.
 */
function toRow(item: BankItem): Row {
  return {
    id: item.id,
    topic: item.topic,
    hindi: item.hindi,
    accepted: item.accepted,
    correct_phrase: item.correctPhrase,
    pattern: item.pattern,
    variations: item.variations,
  };
}

function sameRow(row: Row, existing: Record<string, unknown>) {
  return (
    row.topic === existing.topic &&
    row.hindi === existing.hindi &&
    row.correct_phrase === existing.correct_phrase &&
    row.pattern === existing.pattern &&
    JSON.stringify(row.accepted) === JSON.stringify(existing.accepted) &&
    JSON.stringify(row.variations) === JSON.stringify(existing.variations)
  );
}

function readTopic(topic: Topic) {
  const path = join(BANK_DIR, `${topic}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.log(`  ${topic}: no readable file, skipping`);
    return { items: [], invalid: 0 };
  }

  const raw: unknown[] = Array.isArray(parsed) ? parsed : [];
  const items: BankItem[] = [];
  let invalid = 0;

  for (const [index, entry] of raw.entries()) {
    const result = bankItemSchema.safeParse(entry);
    if (!result.success) {
      invalid++;
      console.log(
        `  ${topic}[${index}] rejected: ${result.error.issues[0]?.path?.join(".") || "(shape)"} ${result.error.issues[0]?.message ?? ""}`,
      );
      continue;
    }
    items.push(result.data);
  }

  if (invalid > 0) console.log(`  ${topic}: ${invalid} of ${raw.length} failed validation`);
  return { items, invalid };
}

/**
 * Dedupe on the normalised Hindi rather than the id, so two ids carrying the same sentence
 * cannot both reach the table. Also checked against what is already there, otherwise
 * re-seeding after an id change would quietly double a sentence.
 */
function dedupe(items: BankItem[], seenHindi: Set<string>) {
  const kept: BankItem[] = [];
  let duplicate = 0;

  for (const item of items) {
    const key = normalizeAnswer(item.hindi);
    if (seenHindi.has(key)) {
      duplicate++;
      continue;
    }
    seenHindi.add(key);
    kept.push(item);
  }

  return { kept, duplicate };
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const only = arg("topic") as Topic | undefined;

  if (only && !TOPICS.includes(only)) {
    console.error(`--topic must be one of: ${TOPICS.join(", ")}`);
    process.exit(1);
  }

  console.log(`Seeding sentences${dryRun ? " (dry run, nothing written)" : ""}\n`);

  const files = readdirSync(BANK_DIR).filter((name) => name.endsWith(".json"));
  const topics = only ? [only] : TOPICS.filter((topic) => files.includes(`${topic}.json`));
  if (topics.length === 0) {
    console.error("No bank files found in src/data/bank");
    process.exit(1);
  }

  const seenHindi = new Set<string>();
  const all: BankItem[] = [];
  let rejected = 0;
  let duplicates = 0;

  for (const topic of topics) {
    const { items, invalid } = readTopic(topic);
    const { kept, duplicate } = dedupe(items, seenHindi);
    rejected += invalid;
    duplicates += duplicate;
    all.push(...kept);
    console.log(`  ${topic.padEnd(12)} ${kept.length} usable, ${duplicate} duplicate`);
  }

  if (!dryRun) {
    if (!url || !serviceKey) {
      console.error(
        "\nMissing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
          "Add SUPABASE_SERVICE_ROLE_KEY to .env.local (Supabase dashboard > Settings > API).\n" +
          "Re-run with --dry-run to check the files without a key.",
      );
      process.exit(1);
    }
  }

  // Existing rows, so the counts can say inserted vs updated rather than just "sent".
  const existing = new Map<string, Record<string, unknown>>();
  if (!dryRun) {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("sentences")
      .select("id, topic, hindi, accepted, correct_phrase, pattern, variations");

    if (error) {
      console.error(`\nCould not read existing sentences: ${error.message}`);
      if (/row-level security|permission denied/i.test(error.message)) {
        console.error(
          "That looks like an RLS rejection, which means SUPABASE_SERVICE_ROLE_KEY is\n" +
            "probably set to the publishable key. It has to be the service_role key.",
        );
      }
      process.exit(1);
    }

    for (const row of data ?? []) existing.set(String(row.id), row);
    console.log(`\n${existing.size} sentence(s) already in the table`);
  }

  const rows = all.map(toRow);
  const toWrite: Row[] = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const previous = existing.get(row.id);
    if (!previous) {
      inserted++;
    } else if (sameRow(row, previous)) {
      unchanged++;
      continue; // Nothing to do, so do not spend a write on it.
    } else {
      updated++;
    }
    toWrite.push(row);
  }

  const skipped = rejected + duplicates;

  console.log(
    `\ninserted ${inserted}  updated ${updated}  unchanged ${unchanged}  skipped ${skipped}` +
      `  (skipped = ${rejected} failed validation + ${duplicates} duplicate Hindi)`,
  );

  if (dryRun) {
    console.log("\nDry run: nothing was written.");
    return;
  }

  if (toWrite.length === 0) {
    console.log("\nAlready in step, nothing to write.");
    return;
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const batches = chunk(toWrite, BATCH_SIZE);
  for (const [index, batch] of batches.entries()) {
    const { error } = await supabase
      .from("sentences")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      console.error(`\nBatch ${index + 1} of ${batches.length} failed: ${error.message}`);
      if (/row-level security|permission denied/i.test(error.message)) {
        console.error(
          "That looks like an RLS rejection, which means SUPABASE_SERVICE_ROLE_KEY is\n" +
            "probably set to the publishable key. It has to be the service_role key.",
        );
      }
      process.exit(1);
    }

    console.log(`  batch ${index + 1}/${batches.length}: ${batch.length} rows`);
  }

  const { count, error: countError } = await supabase
    .from("sentences")
    .select("id", { count: "exact", head: true });

  if (countError) {
    console.error(`\nWrote the rows but could not count them: ${countError.message}`);
    return;
  }

  console.log(`\nDone. ${count} sentence(s) in the table.`);
}

main().catch((error) => {
  console.error("[seed] failed:", error);
  process.exit(1);
});