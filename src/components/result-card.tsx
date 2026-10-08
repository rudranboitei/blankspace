"use client";

import { ListenButton } from "@/components/listen-button";
import { PatternText } from "@/components/pattern-text";
import { WordDiff } from "@/components/word-diff";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { diffAnswer, type Match } from "@/lib/match";
import type { CoachReply } from "@/lib/schema";
import { cn } from "@/lib/utils";

export type CoachState = {
  status: "idle" | "loading" | "ready" | "error";
  data: CoachReply | null;
  error: string | null;
};

function Section({
  label,
  action,
  labelClassName,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  labelClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-[13px] leading-[18px] text-muted-foreground", labelClassName)}>
          {label}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

export function ResultCard({
  item,
  answer,
  match,
  isSaved,
  isSaving,
  isSpeaking,
  coach,
  onToggleListen,
  onExplain,
  onVerify,
  onSave,
  onNext,
}: {
  item: { id: string; correctPhrase: string; pattern: string; variations: string[] };
  answer: string;
  match: Match;
  isSaved: boolean;
  isSaving: boolean;
  isSpeaking: boolean;
  coach: CoachState;
  onToggleListen: () => void;
  onExplain: () => void;
  onVerify: () => void;
  onSave: () => void;
  onNext: () => void;
}) {
  const isBusy = coach.status === "loading";

  // The two replies carry different fields, so narrow before reading either.
  const coached = coach.data?.kind === "explain" ? coach.data : null;
  const verified = coach.data?.kind === "verify" ? coach.data : null;

  // The bank judges locally. The one exception is a verify reply, which is the learner
  // saying "that is wrong, this is what I meant" and getting the last word.
  const isCorrect = match.verdict === "correct" || verified?.verdict === "correct";

  // Once the coach has explained, its phrasing is the one worth learning.
  const phrase = coached?.correctPhrase || item.correctPhrase;
  const pattern = coached?.pattern || item.pattern;
  const variations = coached?.variations.length ? coached.variations : item.variations;
  const note = coached?.note || verified?.note || "";

  // A right answer has nothing to fix, so there is nothing to diff.
  const words = isCorrect ? [] : diffAnswer(answer, phrase);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Section label="You said">
          <p className="font-serif text-xl leading-[30px]">{answer}</p>
        </Section>

        <Section
          label={isCorrect ? "Correct" : match.verdict === "almost" ? "Almost" : "Not quite"}
          labelClassName={isCorrect ? "text-correct" : undefined}
        >
          <WordDiff words={words} />
          {note ? (
            <p className="text-[15px] leading-[22px] text-muted-foreground">{note}</p>
          ) : null}
        </Section>

        <Section
          label={isCorrect ? "Another way to say it" : "Say it like this"}
          action={
            <ListenButton
              isSpeaking={isSpeaking}
              onToggle={onToggleListen}
              label="the phrase"
            />
          }
        >
          <PatternText
            reveal
            text={phrase}
            className="block font-serif text-xl leading-[30px]"
          />
        </Section>

        <Section label="Pattern">
          <PatternText
            reveal
            text={pattern}
            className="block font-serif text-2xl leading-8 font-semibold"
          />
        </Section>

        <Section label="Also works">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 font-serif text-xl leading-[30px] marker:text-muted-foreground">
            {variations.map((variation) => (
              <li key={variation}>{variation}</li>
            ))}
          </ul>
        </Section>

        {/* Two paid actions, and only here. Everything above was decided on the device. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExplain} disabled={isBusy}>
            {coach.status === "loading" && coach.data === null ? "Thinking" : "Explain"}
          </Button>

          {!isCorrect && !verified ? (
            <Button variant="ghost" size="sm" onClick={onVerify} disabled={isBusy}>
              My answer is right, check it
            </Button>
          ) : null}

          {isBusy ? (
            <span role="status" className="text-[13px] leading-[18px] text-muted-foreground">
              Asking the coach
            </span>
          ) : null}

          {coach.status === "error" && coach.error ? (
            <p role="status" className="text-[13px] leading-[18px] text-fix">
              {coach.error}
            </p>
          ) : null}
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2 border-t border-border py-3">
        <Button variant="outline" onClick={onSave} disabled={isSaved || isSaving}>
          {isSaved ? "Saved" : "Save pattern"}
        </Button>
        <Button onClick={onNext}>Next sentence</Button>
      </CardFooter>
    </Card>
  );
}