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
- Loading: Skeleton lines inside the result area only. No full-page spinners.

## Motion
One moment only: when a result appears, the slot underlines draw left to right, 450ms, staggered 120ms per slot. Nothing else animates on its own. No fade-up entrances, no hover effects on cards. Button press and focus states are fine. Respect `prefers-reduced-motion`.

## Copy
- Sentence case. Plain verbs. Say what happens.
- Buttons: "Check answer", "Save pattern", "Next sentence", "Remove". The same action keeps the same name everywhere ("Save pattern" produces a toast "Pattern saved").
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
The route handler returns JSON where `correctPhrase` and `pattern` mark swappable parts with `{braces}`:
`{ correctPhrase, pattern, variations: string[2], note }`
Render both through `<PatternText />`. `note` is one plain sentence in Hind, no formatting.

## Quality floor
Mobile first. Visible keyboard focus. Text contrast at least 4.5:1. Dark mode supported through the `.dark` class.

## Instruction for the coding agent
Before writing or editing any UI, read DESIGN.md and use only the tokens in globals.css. After building a screen, check it against the "Never do" list and remove anything that appears there.
