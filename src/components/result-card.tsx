"use client";

import { PatternText } from "@/components/pattern-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import type { Feedback } from "@/lib/schema";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] leading-[18px] text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export function ResultCard({
  userAnswer,
  feedback,
  isSaved,
  onSave,
  onNext,
}: {
  userAnswer: string;
  feedback: Feedback;
  isSaved: boolean;
  onSave: () => void;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Section label="You said">
          <p className="font-serif text-xl leading-[30px]">{userAnswer}</p>
        </Section>

        <Section label="Say it like this">
          <PatternText
            reveal
            text={feedback.correctPhrase}
            className="block font-serif text-xl leading-[30px]"
          />
          <p className="text-[15px] leading-[22px] text-muted-foreground">{feedback.note}</p>
        </Section>

        <Section label="Pattern">
          <PatternText
            reveal
            text={feedback.pattern}
            className="block font-serif text-2xl leading-8 font-semibold"
          />
        </Section>

        <Section label="Also works">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 font-serif text-xl leading-[30px] marker:text-muted-foreground">
            {feedback.variations.map((variation) => (
              <li key={variation}>{variation}</li>
            ))}
          </ul>
        </Section>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 border-t border-border py-3">
        <Button variant="outline" onClick={onSave} disabled={isSaved}>
          {isSaved ? "Saved" : "Save pattern"}
        </Button>
        <Button onClick={onNext}>Next sentence</Button>
      </CardFooter>
    </Card>
  );
}