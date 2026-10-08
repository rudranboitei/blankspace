import { createClient } from "@/lib/supabase/client";
import { recentSentenceIds, rememberSentence } from "@/lib/recent-sentences";
import type { BankItem } from "@/lib/schema";
import type { Topic } from "@/lib/topics";

/** The columns the app reads. `status` is filtered by RLS, and asked for again anyway. */
const COLUMNS = "id, topic, hindi, accepted, correct_phrase, pattern, variations";

type SentenceRow = {
  id: string;
  topic: string;
  hindi: string;
  accepted: string[] | null;
  correct_phrase: string;
  pattern: string;
  variations: unknown;
};

function toBankItem(row: SentenceRow): BankItem {
  return {
    id: row.id,
    // The column is plain text, and every row is written by the seed from TOPICS, so this
    // cast is safe. A topic outside the list simply renders no tab, it does not break.
    topic: row.topic as Topic,
    hindi: row.hindi,
    accepted: row.accepted ?? [],
    correctPhrase: row.correct_phrase,
    pattern: row.pattern,
    // jsonb arrives as whatever was written, so a non-array has to be treated as absent
    // rather than rendered into the UI.
    variations: Array.isArray(row.variations) ? row.variations.map(String) : [],
  };
}

/**
 * Ids only, so the exclusion list and the random pick happen on a few hundred bytes
 * instead of dragging every accepted array across the wire.
 */
async function fetchIds(topic: Topic, exclude: string[]) {
  const supabase = createClient();

  const query = supabase
    .from("sentences")
    .select("id")
    .eq("topic", topic)
    .eq("status", "approved");

  const filtered = exclude.length
    ? await query.not("id", "in", `(${exclude.join(",")})`)
    : await query;

  if (filtered.error) throw new Error(filtered.error.message);
  return (filtered.data ?? []).map((row) => row.id as string);
}

/**
 * One random approved sentence for a topic, from Postgres.
 *
 * The draw is done on the client over the id list rather than in SQL. It needs the last ten
 * excluded, which means the query has to depend on session state the database never sees,
 * and a topic is only fifty rows, so the extra round trip for the chosen row costs less than
 * shipping every accepted list to decide which one to use.
 */
export async function fetchRandomSentence(topic: Topic): Promise<BankItem | null> {
  const excluded = recentSentenceIds();
  let ids = await fetchIds(topic, excluded);

  // A topic with fewer sentences than the exclusion list would otherwise come back empty.
  if (ids.length === 0) {
    ids = await fetchIds(topic, []);
  }
  if (ids.length === 0) return null;

  const id = ids[Math.floor(Math.random() * ids.length)];

  const supabase = createClient();
  const { data, error } = await supabase
    .from("sentences")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  rememberSentence(id);
  return toBankItem(data as SentenceRow);
}

/** Just the id, so a caller can check one specific sentence without drawing at random. */
export async function fetchSentenceById(id: string): Promise<BankItem | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sentences")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? toBankItem(data as SentenceRow) : null;
}