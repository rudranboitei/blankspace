# Pattern Practice: design system

Read this file before touching any UI. If a choice here conflicts with your defaults, this file wins.

## Product
Hindi speakers practice natural English phrase patterns. The core job: see a Hindi sentence, try it in English, then see the correct phrase and the reusable pattern behind it.

## Concept: fill the slot
The pattern sentence with its swappable parts marked is the one memorable element of the app. Everything else stays quiet and plain. Think of a well-set exercise book, not a SaaS dashboard.

Example: After {learning React}, I need to {learn AI}.
The `{braces}` parts render as marked slots (see `pattern-text.tsx`).

## Color
Only use these tokens (defined in `globals.css`). Never hardcode hex in components.

| Name | Light | Dark | Use |
|---|---|---|---|
| Paper | #F1F3F6 | #0E1522 | page background |
| Ink | #152238 | #E6EAF1 | text, primary button |
| Surface | #FAFBFC | #151F33 | result block |
| Line | #D5DAE3 | #26334D | 1px borders |
| Muted | #566176 | #94A0B5 | secondary text |
| Marigold (slot) | #E3A008 | #F2B632 | slots only |
| Correct | #1E7A57 | #4CBF93 | success state only |
| Fix | #B3263E | #F27A8C | errors only |

Rules:
- Marigold appears only on slots. Never on buttons, links, icons or backgrounds.
- Primary button is solid Ink with Paper text.
- No gradients, no glow, no shadows. Separation comes from 1px lines and spacing.

## Typography
Two families, clearly different, with one rule: **serif = the English you are learning, sans = everything else.**

- **Literata** (`font-serif`): English phrases, patterns, "Say it like this", saved patterns.
- **Hind** (`font-sans`): UI, Hindi prompt sentence, notes, buttons. Supports Devanagari.

Scale (mobile / desktop):
- Pattern sentence: Literata 600, 24/32 and 28/36
- Phrase text: Literata 400, 20/30
- Hindi prompt: Hind 500, 20/30
- UI text: Hind 400, 15/22
- Small text: Hind 400, 13/18

Sentence case everywhere. No all caps, no letter-spacing tricks, no italic or colored single words in headings. Keep lines under 65 characters.

## Layout
Single column, left aligned, `max-w-xl`, 20px page padding on mobile. No hero section, no centered marketing layout.

```
Pattern Practice                  Library
--------------------------------------------
Mujhe React seekhne ke baad AI bhi
seekhna padega.

[ Your English version                    ]
[                                         ]
[mic]                       [Check answer]

You said
After learning React, I need to focus.

Say it like this
After [learning React], I need to [learn AI].

Pattern
After [doing something], I need to [do the next thing].

Also works
- After finishing the course, I need to practice.
- After joining the team, I need to learn the codebase.

[Save pattern]  [Next sentence]
```

## Components
- Use shadcn `Card` only for the result block. Library page is a plain list with 1px dividers, not a grid of cards.
- Radii by role, not one value for everything: slots 4px (`rounded-sm`), buttons and inputs 6px (`rounded-md`), result block 8px (`rounded-lg`).
- Textarea: 1px Line border, 2px Ink focus ring. Min touch target 44px on mobile.
- Mic button is an icon button with an `aria-label`. Use lucide icons at 18px, no icons inside colored circles.
- Listen button is the same 36px icon button, on the right of the section label row so the phrase keeps the full column width. Volume2 idle, VolumeX while playing, `aria-pressed` on it.
- Hint sits in the input row beside the mic, ghost variant, small. It reveals a single muted line above the textarea, "Starts with {words}". The words are serif, the label is not.
- Loading: Skeleton lines inside the result area only. No full-page spinners.

## Result block states

The verdict comes from a local comparison against the bank, so the block branches on a word the
learner has already written rather than on anything a model decided.

- `correct` is the good case: a "Correct" label in the Correct token, and the phrase relabelled "Another way to say it", because it is an alternative rather than an instruction.
- `almost` is "Almost", and `not quite` is "Not quite". Both show the word diff.
- The diff marks the learner's own wrong words in Fix, struck through, and the words the phrase had that they left out in Correct. Only for the two imperfect verdicts: a right answer has nothing to fix.
- "Pattern" and "Also works" always show, since the pattern behind what they said is the lesson.

Two buttons below the diff spend money, and only two: "Explain" and "My answer is right, check
it". The second appears only while the answer is not yet accepted, and disappears once the coach
has ruled on it.

## Spaced review

Review is a Leitner ladder in six boxes. With an account the ladder lives in `saved_patterns`
and survives a change of device; signed out it lives in `localStorage` for that browser only.
A pattern starts in box 1 and is due immediately. "Got it" moves it up one box and schedules
the next visit; "Again" drops it back to box 1 and makes it due right now, so it comes back
before the session ends.

The wait is read from the box the learner was in when they answered, so the first step is
actually one day:

| Box left | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Days until it returns | 1 | 2 | 4 | 8 | 16 | 16 |

Box 6 is the cap, so a pattern never disappears for longer than about two weeks. One card is
shown at a time, not a list. The order is: Hindi alone, then "Show answer", then the phrase
with a Listen button, then "Got it" or "Again". Nothing is graded, so there is no score and
no streak.

Signing in moves whatever was saved as a guest into the account, keeping each pattern's box,
then empties the browser store. It runs once, and a save it cannot move stays in the browser
rather than being dropped.

## Motion
One moment only: when a result appears, the slot underlines draw left to right, 450ms, staggered 120ms per slot. Nothing else animates on its own. No fade-up entrances, no hover effects on cards. Button press and focus states are fine. Respect `prefers-reduced-motion`.

## Copy
- Sentence case. Plain verbs. Say what happens.
- Buttons: "Check answer", "Save pattern", "Next sentence", "Remove", "Hint", "Show answer", "Got it", "Again", "Explain", "My answer is right, check it". The same action keeps the same name everywhere ("Save pattern" produces a toast "Pattern saved").
- Errors say what went wrong and what to do: "Couldn't check your answer. Check your connection and try again."
- Empty library: "No saved patterns yet. Save one after you check an answer."
- No emoji, no exclamation marks, no "Oops", no "Let's go", no "Welcome back".

## Never do
- Purple or blue-violet gradients, glassmorphism, glowing borders
- Cream background with a terracotta accent, or near-black with acid green
- Eyebrow labels in all caps, text joined with middle dots, arrows added to button text
- Identical rounded cards in a grid, stats banners, feature tiles
- Decorative icons, illustrations or emoji

## Data contract with the API

Sentences and verdicts come from `src/data/bank/<topic>.json`, not from a route. Each item is
`{ id, topic, hindi, accepted[], correctPhrase, pattern, variations[] }`, where `accepted` is the
set of wordings that count as fully right and `correctPhrase` is one of them, written with its
swappable parts in `{braces}`.

A learner's answer is normalised, then compared against `accepted` plus the phrase itself:
exact is "Correct", 85% or more is "Almost", below that is "Not quite".

`POST /api/explain` is the only route, reached for by the Explain and check-my-answer buttons.
`mode: "explain"` returns `{ correctPhrase, pattern, variations, note }` and deliberately no
verdict, because the bank already decided that on the device. `mode: "verify"` returns
`{ verdict, note }` and is the only way a verdict ever comes back from a model.

Render `correctPhrase` and `pattern` through `<PatternText />`. `note` is one plain sentence in
Hinglish, no formatting, and the line is omitted entirely when the model leaves it out.

## Quality floor
Mobile first. Visible keyboard focus. Text contrast at least 4.5:1. Dark mode supported through the `.dark` class.

## Instruction for the coding agent
Before writing or editing any UI, read DESIGN.md and use only the tokens in globals.css. After building a screen, check it against the "Never do" list and remove anything that appears there.
