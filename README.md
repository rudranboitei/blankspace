# Pattern Practice

An English practice app for Hindi speakers. You read a short Hinglish sentence, write your
English version, and get back the phrase a native speaker would actually say, the reusable
pattern behind it, and two more sentences that use the same pattern.

Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui, Groq.

## Setup

```bash
bun install
cp .env.example .env.local   # add your Groq API key
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

| Variable | Required | Notes |
|---|---|---|
| `GROQ_API_KEY` | yes | From [Groq console](https://console.groq.com/keys). Server only, never sent to the browser. |
| `GROQ_MODEL` | no | Defaults to `openai/gpt-oss-20b`. Set `openai/gpt-oss-120b` for deeper patterns at 2x the price. |

## How it works

- `GET /` is the practice screen. A topic tab picks the situation, the API writes one Hinglish
  sentence for it, you answer, and the result block shows your answer, the correct phrase with
  its swappable slots, the pattern, two variations, and one line on what was off.
- The mic button is optional input through the Web Speech API. Browsers without it keep typing.
- "Save pattern" writes to `localStorage`, so `/library` is a plain list with search and a
  review mode that hides the English until you ask for it.

### API

Both routes are `POST` and both validate their input with Zod before calling Groq.

```bash
curl -X POST localhost:3000/api/sentence -H 'content-type: application/json' -d '{"topic":"tech-work"}'
# {"sentence":"mujhe is task me thoda help chahiye, kya tumhare paas time hai"}

curl -X POST localhost:3000/api/check -H 'content-type: application/json' \
  -d '{"topic":"tech-work","hindi":"...","userAnswer":"..."}'
# {"correctPhrase":"I'm {stuck on this task}, do you have {a few minutes}?","pattern":"...",
#  "variations":["...","..."],"note":"..."}
```

The model is asked for JSON only, Groq runs in JSON mode, replies are parsed with `JSON.parse`
and then validated with Zod (`src/lib/schema.ts`), and an unusable reply is retried once with a
stricter instruction and twice the token budget. Devanagari in a reply fails validation, because
small models drift into native script. Rate limits, overload, timeouts, blocked content and a
missing key each come back as a plain sentence the UI shows in a toast. `src/lib/groq.ts` owns
all of that, over plain `fetch` against the OpenAI-compatible endpoint, so there is no SDK
dependency.

### Model choice

`openai/gpt-oss-20b` is the cheapest model on Groq that still returns all four keys, at
$0.075/M input and $0.30/M output with reasoning set to `low`. It is noticeably shallower than
`openai/gpt-oss-120b`, which is 2x the price and still far cheaper than the Gemini model this
used to run on. Set `GROQ_MODEL` to switch; nothing else changes.

## Project layout

```
src/app/api/check       POST: score an answer, return the pattern
src/app/api/sentence    POST: write one Hinglish sentence for a topic
src/app/library         saved patterns, search, review mode
src/components          screens and shadcn/ui primitives
src/hooks               localStorage library, Web Speech input
src/lib                 Groq client, prompts, Zod schemas, topics
```

`DESIGN.md` is the source of truth for anything visual. Read it before changing UI.

No auth, no database. Patterns live in `localStorage` for now.

# blankspace
