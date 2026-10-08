# Pattern Practice

An English practice app for Hindi speakers. You read a short Hinglish sentence, write your
English version, and get back the phrase a native speaker would actually say, the reusable
pattern behind it, and two more sentences that use the same pattern.

Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui, Groq, Supabase Auth.

## Setup

```bash
bun install
cp .env.example .env.local   # add your Groq API key and your Supabase URL and publishable key
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | no | Only the Explain and check-my-answer buttons use it, and only for a wording the bank has not seen. From [Groq console](https://console.groq.com/keys). Server only. |
| `GROQ_MODEL` | no | Defaults to `openai/gpt-oss-20b`. |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project Settings > API. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | The `sb_publishable_` key, not the legacy `anon` JWT. |

### Supabase

Auth is email and password, no OAuth providers. In the Supabase dashboard, set
**Authentication > URL Configuration > Site URL** to `http://localhost:3000` and add
`http://localhost:3000/**` to the redirect allow list. That is what makes the
confirmation email land back on `/auth/callback`. If **Confirm email** is on, a new
account has to confirm before it can sign in, which is the default.

Sentences, saved patterns, attempts and cached coaching live in Postgres. The schema is in
`supabase/migrations`, row level security is on for all four tables, and `sentences` is the
only one a signed-out browser may read.

`saved_patterns` is one row per sentence per account. Signed out there is no account, so saves
go to `localStorage` instead, and the first signed-in page load moves them into the account
with their Leitner box intact before emptying the browser store. A save that cannot be moved,
because its sentence has since been retired, stays in the browser and is retried next visit
rather than being dropped.

## How it works

- `GET /` is the practice screen. A topic tab picks the situation, the app draws one Hinglish
  sentence from the `sentences` table of 150, you answer, and the result block shows your answer,
  the phrase with its swappable slots, the pattern, and two more sentences that use the same
  pattern.
- **Nothing on that path calls a model.** The sentence is one row read, the verdict is a local
  comparison, and the slots are computed. Opening a screen, answering, and reading the result
  cost nothing and cannot be rate limited.
- Your answer is normalised (lower case, punctuation dropped, contractions written out, so
  `I'm` and `I am` are the same) and compared with the wordings the item accepts. An exact
  match is "Correct". From 85% similar upwards it is "Almost". Anything else is "Not quite",
  and the result block shows a word diff marking the words you got wrong in Fix and the words
  you left out in Correct.
- Two buttons spend money, and only two. **Explain** asks the coach why, and **My answer is
  right, check it** spends one call re-judging a wording the bank does not list. Both are
  cached on `sentenceId` plus the normalised answer, so the same answer never costs two calls
  and a rate limit can only bite once per distinct question.
- The mic button is optional input through the Web Speech API. Browsers without it keep typing.
  The Listen button reads a phrase out loud with `speechSynthesis`, also free, so the loop is
  speak it, hear it, say it. Opening the mic stops anything still talking, otherwise the
  synthesiser gets transcribed straight back into the textarea.
- Hint reveals the first few words of the phrase, read straight off the sentence. Free.
- "Save pattern" writes to `saved_patterns`, or to `localStorage` signed out. `/library` is a
  plain list with search plus a review mode, read as one joined query so each row carries both
  the sentence and its review state. Review is a six-box Leitner ladder: the Hindi on its own,
  you say the English, then "Got it" or "Again". "Got it" waits 1, 2, 4, 8, 16 days by the box
  it was on; "Again" drops it back to the first box and makes it due now, so it returns in the
  same sitting.

### Auth

An account is optional. `src/proxy.ts` refreshes the session cookie on every request, lets a
signed-out visitor reach `/` and `/library`, bounces a signed-in one away from `/login`, and
sends anyone else to `/login?next=<where they were headed>`. The coach route skips the Proxy
matcher entirely and answers with JSON, and it works signed out: it reads nothing belonging to
the caller, and its cache is on the sentence, so a guest question is usually already answered
by someone else's.

Session state lives in cookies, read through two helpers: `createClient` in
`src/lib/supabase/client.ts` for Client Components and in `src/lib/supabase/server.ts` for
everything on the server. Both use `@supabase/ssr` with only `getAll` and `setAll`, and
only the Proxy writes cookies on a normal page load.

### The bank

`src/data/bank/<topic>.json` holds the situations, committed to the repo and imported per topic
so a learner only downloads what they are practising.

```json
{
  "id": "tw-014",
  "topic": "tech-work",
  "hindi": "Mujhe React seekhne ke baad AI bhi seekhna padega.",
  "accepted": ["After learning React, I need to learn AI.", "..."],
  "correctPhrase": "After {learning React}, I need to {learn AI}.",
  "pattern": "After {doing something}, I need to {do the next thing}.",
  "variations": ["After finishing the course, I need to practice."]
}
```

`accepted` carries the weight. It is the set of wordings that count as fully right, so the
thicker it is the fewer correct answers get marked wrong by a bank that cannot ask the model.
`correctPhrase` must be one of them.

Rebuilding and checking it:

```bash
bun run bank:generate                        # tops each topic up to 50, keeps what is there
bun run bank:generate -- --topic tech-work --count 20
bun run bank:validate                        # shape and invariants, exits 1 on a fault
bun run bank:validate -- --fix               # re-slots phrases and unnests patterns
```

`gpt-oss-20b` will not wrap `correctPhrase` in braces, which is where every item's swappable
parts are supposed to live, so the generator does not ask it to. `slotize` treats the pattern
as a skeleton: its unbraced words must appear in the phrase in order, and whatever falls
between them becomes a slot. `After {doing something}, I need to {do the next thing}.` against
`After learning React, I need to learn AI.` gives
`After {learning React}, I need to {learn AI}.` If it cannot line up, or if it would change
the wording, it leaves the sentence plain rather than risk cutting in the wrong place.

**These are drafts and they need a human read.** The shape is checked, the slots are checked,
and a script confirms every wording an item claims is accepted by the matcher that ships with
it, but nothing here can tell you a phrase reads well. A phrase that is grammatical but not how
a native speaker would put it teaches the wrong thing, and the learner has no way to tell.

### Coach API

One route, `POST /api/explain`, requiring a session and validating with Zod before calling Groq.

```bash
curl -X POST localhost:3000/api/explain -H 'content-type: application/json' -d '{
  "cacheKey":"tw-014:after learning react i need to learn ai",
  "topic":"tech-work","hindi":"...","answer":"...","mode":"explain"}'
# {"kind":"explain","correctPhrase":"...","pattern":"...","variations":["..."],"note":"..."}

# mode "verify" instead asks the one question the bank cannot: was an unusual answer right?
# {"kind":"verify","verdict":"correct","note":"..."}
```

The two modes answer different questions and have different shapes. `explain` never returns a
verdict, because the bank already decided that on the device; asking for one only invited the
model to invent a value.

Replies are parsed with `JSON.parse` and validated with Zod (`src/lib/schema.ts`), and an
unusable reply is retried once with a stricter instruction and twice the token budget. Every
field is optional in the schema, because `gpt-oss-20b` drops keys often and a missing line of
copy is cheaper than losing the whole reply. It also writes slots as alternations,
`{help me|assist me}`, and leaves spaces before punctuation; `tidySlots` fixes both before the
phrase is rendered or read aloud. Rate limits, overload, timeouts, blocked content and a missing
key each come back as a plain sentence for the toast. `src/lib/groq-client.ts` owns all of that,
over plain `fetch` against the OpenAI-compatible endpoint, so there is no SDK dependency.

### Model choice

`openai/gpt-oss-20b` at $0.075/M input and $0.30/M output with reasoning set to `low`. Since the
bank now answers almost everything, the only spend is a coach call, so the model choice costs
almost nothing either way. Set `GROQ_MODEL` to switch.

The free tier allows 8000 tokens a minute. A coach call spends roughly 1600 of them, so about
five a minute before Groq starts refusing, and the cache means most sessions never approach it.

Patterns saved before spaced review existed have no `box` or `dueAt` in `localStorage`. They are
filled in on read rather than discarded, so an old library starts at box 1 and is due right away.
Records saved before the bank existed are dropped on read, since their wording no longer matches
any bank item.

## Project layout

```
src/app/api/explain     POST: the only route that spends money, and only when asked
src/app/auth/callback   turns a confirmation or sign-in link into a session cookie
src/app/library         saved patterns, search, review mode
src/app/login           sign in and create account
src/components          screens and shadcn/ui primitives
src/data/bank           the committed practice bank, one file per topic
src/hooks               the pattern store (database or localStorage), Web Speech input and output
scripts                 bank:generate and bank:validate, run once and then to top up
src/lib                 normalising, matching, slots, Groq client, prompts, schemas
src/lib/supabase        browser client, server client, sign-out action
src/proxy.ts            refreshes the session, lets guests through to / and /library
```

`DESIGN.md` is the source of truth for anything visual. Read it before changing UI.

`bun run seed` fills `sentences` from `src/data/bank/<topic>.json`. It is idempotent: rows
matching the file are left alone, so only edited sentences are written. `--dry-run` reports
what it would do and `--topic <id>` narrows it.

# blankspace
