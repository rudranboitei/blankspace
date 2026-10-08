-- Blankspace: the practice bank, a learner's saved patterns, their attempts, and a cache
-- of coaching replies.
--
-- RLS is on for all four. `sentences` is the only one a client may read without a session,
-- and only the approved rows. The service role bypasses RLS entirely, which is what lets the
-- seed script and the Explain route write `explanations` while no client can.

-- ---------------------------------------------------------------------------
-- sentences: the practice bank, seeded from src/data/bank/*.json
-- ---------------------------------------------------------------------------
create table if not exists public.sentences (
  id text primary key,
  topic text not null,
  hindi text not null,
  -- Every wording that counts as fully right. This is what lets the app grade an answer
  -- without asking a model anything.
  accepted text[] not null,
  correct_phrase text not null,
  pattern text not null,
  variations jsonb not null default '[]'::jsonb,
  difficulty smallint not null default 1,
  status text not null default 'approved',
  created_at timestamptz not null default now()
);

comment on table public.sentences is
  'Committed practice bank. status filters what learners are shown.';

-- ---------------------------------------------------------------------------
-- saved_patterns: one row per sentence a learner has kept, with its review position
-- ---------------------------------------------------------------------------
create table if not exists public.saved_patterns (
  id uuid primary key default gen_random_uuid(),
  -- NOT NULL on purpose: the unique constraint below cannot express "one per pair"
  -- if either side is null, and a row with no owner is never wanted.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sentence_id text not null references public.sentences (id) on delete cascade,
  user_answer text,
  -- Leitner box. Six is the top box, matching MAX_BOX in src/hooks/use-library.ts.
  box smallint not null default 1,
  next_review_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint saved_patterns_user_sentence_key unique (user_id, sentence_id),
  constraint saved_patterns_box_range check (box between 1 and 6)
);

-- ---------------------------------------------------------------------------
-- attempts: every answer checked, so the work is reviewable later
-- ---------------------------------------------------------------------------
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  -- Nullable on purpose: the table is written for guests too, by the server, which has a
  -- user id only when there is a session. Guests simply insert null here.
  user_id uuid references auth.users (id) on delete cascade,
  sentence_id text not null references public.sentences (id) on delete cascade,
  user_answer text not null,
  result text not null,
  created_at timestamptz not null default now(),
  constraint attempts_result_valid check (result in ('correct', 'almost', 'wrong'))
);

-- ---------------------------------------------------------------------------
-- explanations: cached coaching replies, keyed by sentence plus a hash of the answer
-- ---------------------------------------------------------------------------
create table if not exists public.explanations (
  id uuid primary key default gen_random_uuid(),
  sentence_id text not null references public.sentences (id) on delete cascade,
  -- sha256 of the normalised answer. A hash, not the text, so the cache is a lookup and not
  -- a second copy of everything a learner has typed.
  answer_hash text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  constraint explanations_sentence_answer_key unique (sentence_id, answer_hash)
);

-- ---------------------------------------------------------------------------
-- Indexes for the two reads that happen on every practice session
-- ---------------------------------------------------------------------------
create index if not exists sentences_topic_status_idx
  on public.sentences (topic, status);

create index if not exists saved_patterns_user_next_review_idx
  on public.saved_patterns (user_id, next_review_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.sentences enable row level security;
alter table public.saved_patterns enable row level security;
alter table public.attempts enable row level security;
alter table public.explanations enable row level security;

-- `select auth.uid()` rather than a bare `auth.uid()`: the bare form is re-evaluated per row,
-- the wrapped form is resolved once per query.
-- sentences: readable by anyone, approved rows only.
create policy sentences_read_approved
  on public.sentences
  for select
  to anon, authenticated
  using (status = 'approved');

-- saved_patterns: a learner sees and changes only their own rows.
create policy saved_patterns_read_own
  on public.saved_patterns
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy saved_patterns_insert_own
  on public.saved_patterns
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy saved_patterns_update_own
  on public.saved_patterns
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy saved_patterns_delete_own
  on public.saved_patterns
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- attempts: same, and deliberately with no policy for anon. A guest attempt is written by the
-- server with a session or with the service role, never straight from a browser.
create policy attempts_read_own
  on public.attempts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy attempts_insert_own
  on public.attempts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy attempts_update_own
  on public.attempts
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy attempts_delete_own
  on public.attempts
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- explanations: no policies at all. RLS enabled with zero policies means the anon and
-- authenticated roles match nothing, so no client can read or write the cache. Only the
-- service role, which bypasses RLS, can.