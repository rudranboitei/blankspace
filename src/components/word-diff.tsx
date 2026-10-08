"use client";

import type { DiffWord } from "@/lib/match";

/**
 * The learner's words next to the phrase the bank would have said. `extra` is theirs to
 * fix, `missing` is what they left out, and the Fix and Correct tokens are used here
 * because this is exactly the success and error case they are for.
 */
export function WordDiff({ words }: { words: DiffWord[] }) {
  if (words.length === 0) return null;

  return (
    <p className="font-serif text-[15px] leading-[26px]">
      {words.map((word, index) => (
        <span
          key={index}
          className={
            word.kind === "extra"
              ? "text-fix line-through decoration-fix/50"
              : word.kind === "missing"
                ? "text-correct"
                : undefined
          }
        >
          {word.text}{" "}
        </span>
      ))}
    </p>
  );
}