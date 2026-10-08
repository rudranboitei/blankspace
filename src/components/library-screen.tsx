"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ListenButton } from "@/components/listen-button";
import { MicButton } from "@/components/mic-button";
import { PatternText } from "@/components/pattern-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSavedPatterns } from "@/hooks/use-saved-patterns";
import { useSpeech } from "@/hooks/use-speech";
import { useSpeechInput } from "@/hooks/use-speech-input";
import type { SavedRow } from "@/lib/saved-patterns";
import { TOPIC_LABELS } from "@/lib/topics";

type Mode = "saved" | "review";

const DAY_MS = 24 * 60 * 60 * 1000;

function matches(row: SavedRow, query: string) {
  if (!query) return true;
  const sentence = row.sentence;
  return [sentence.hindi, sentence.correctPhrase, sentence.pattern, row.userAnswer ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function SavedRowView({ row, onRemove }: { row: SavedRow; onRemove: () => void }) {
  const sentence = row.sentence;

  return (
    <div className="flex items-start gap-3 border-b border-border py-4 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Badge variant="outline">{TOPIC_LABELS[sentence.topic]}</Badge>
        <p className="font-sans text-[15px] leading-[22px] text-muted-foreground">
          {sentence.hindi}
        </p>
        <PatternText
          text={sentence.correctPhrase}
          className="block font-serif text-xl leading-[30px]"
        />
        <PatternText
          text={sentence.pattern}
          className="block font-serif text-[15px] leading-[22px] text-muted-foreground"
        />
      </div>
      <Button variant="ghost" size="sm" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

/**
 * One review card: the Hindi on its own, the learner says the English, then says whether
 * they got it. Nothing is graded, so there is no score and no streak.
 */
function ReviewCard({
  row,
  remaining,
  onRate,
}: {
  row: SavedRow;
  remaining: number;
  onRate: (gotIt: boolean) => void;
}) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [heard, setHeard] = useState("");
  const voice = useSpeech();
  const speech = useSpeechInput(setHeard);

  const toggleMic = () => {
    // Otherwise the phrase talks over the microphone and lands in the transcript.
    if (!speech.isListening) voice.stop();
    speech.toggle();
  };

  const sentence = row.sentence;

  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <Badge variant="outline">{TOPIC_LABELS[sentence.topic]}</Badge>
        <span className="text-[13px] leading-[18px] text-muted-foreground">
          {remaining} left
        </span>
      </div>

      <p className="font-sans text-xl leading-[30px] font-medium">{sentence.hindi}</p>

      {!isRevealed ? (
        <div className="flex items-center gap-2">
          {speech.isSupported && (
            <MicButton isListening={speech.isListening} onToggle={toggleMic} />
          )}
          <Button variant="ghost" size="sm" onClick={() => setIsRevealed(true)}>
            Show answer
          </Button>
        </div>
      ) : (
        <>
          {heard ? (
            <p className="text-[13px] leading-[18px] text-muted-foreground">Heard: {heard}</p>
          ) : null}

          <div className="flex items-start justify-between gap-3">
            <PatternText
              text={sentence.correctPhrase}
              className="font-serif text-xl leading-[30px]"
            />
            {voice.isSupported && (
              <ListenButton
                isSpeaking={voice.isSpeaking}
                onToggle={() =>
                  voice.isSpeaking ? voice.stop() : voice.speak(sentence.correctPhrase)
                }
                label="the phrase"
              />
            )}
          </div>

          <PatternText
            text={sentence.pattern}
            className="block font-serif text-[15px] leading-[22px] text-muted-foreground"
          />

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => onRate(true)}>
              Got it
            </Button>
            <Button variant="outline" size="sm" onClick={() => onRate(false)}>
              Again
            </Button>
          </div>
        </>
      )}

      {speech.error ? (
        <p role="status" className="text-[13px] leading-[18px] text-fix">
          {speech.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The queue for one sitting: everything already due, soonest first. Built when Review is
 * opened and after each rating, so the clock is read in an event rather than during render,
 * which Cache Components treats as an unstable value.
 */
function buildQueue(rows: SavedRow[], now: number) {
  return rows.filter((row) => new Date(row.nextReviewAt).getTime() <= now);
}

export function LibraryScreen() {
  const { rows, source, isLoading, error, remove, restore, rate } = useSavedPatterns();
  const [mode, setMode] = useState<Mode>("saved");
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<SavedRow[] | null>(null);
  const [isRating, setIsRating] = useState(false);

  const visible = useMemo(
    () => rows.filter((row) => matches(row, query.trim().toLowerCase())),
    [rows, query],
  );

  const handleRemove = async (row: SavedRow) => {
    try {
      await remove(row);
      toast("Pattern removed", {
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              try {
                await restore(row);
              } catch {
                toast.error("Couldn't put that back.");
              }
            })();
          },
        },
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't remove that pattern.");
    }
  };

  const openTab = (next: string) => {
    const target = next === "review" ? "review" : "saved";
    setMode(target);
    setQueue(target === "review" ? buildQueue(rows, Date.now()) : null);
  };

  /**
   * "Got it" leaves the queue. "Again" goes to the back and is due right now, so it returns
   * before the sitting ends.
   */
  const handleRate = async (gotIt: boolean) => {
    const current = queue?.[0];
    if (!current || isRating) return;

    setIsRating(true);
    try {
      await rate(current, gotIt);
      setQueue(gotIt ? queue!.slice(1) : queue!);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't save that. Try again.");
    } finally {
      setIsRating(false);
    }
  };

  const isReviewing = mode === "review";
  const current = queue?.[0];
  const savedEmpty =
    rows.length === 0
      ? "No saved patterns yet. Save one after you check an answer."
      : "No patterns match that search.";

  return (
    <div className="flex flex-col gap-5">
      {mode === "saved" ? (
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search patterns"
          aria-label="Search saved patterns"
        />
      ) : null}

      <Tabs value={mode} onValueChange={openTab}>
        <div className="flex items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="saved">Saved</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
          </TabsList>
          {isReviewing ? (
            <Badge variant="outline">{queue?.length ?? 0} due</Badge>
          ) : (
            <Badge variant="outline">
              {rows.length} {rows.length === 1 ? "pattern" : "patterns"}
            </Badge>
          )}
        </div>

        <TabsContent value="saved">
          {error ? (
            <p className="text-[15px] leading-[22px] text-fix">{error}</p>
          ) : isLoading ? (
            <div className="flex flex-col gap-3 py-2" aria-hidden>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-4/5" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[15px] leading-[22px] text-muted-foreground">{savedEmpty}</p>
              {source === "guest" ? <GuestNote /> : null}
            </div>
          ) : (
            <div className="flex flex-col">
              {visible.map((row) => (
                <SavedRowView
                  key={row.id}
                  row={row}
                  onRemove={() => void handleRemove(row)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="review">
          {error ? (
            <p className="text-[15px] leading-[22px] text-fix">{error}</p>
          ) : isLoading ? (
            <div className="flex flex-col gap-2 py-2" aria-hidden>
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-2/3" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-[15px] leading-[22px] text-muted-foreground">
              Nothing to review yet. Save a pattern first.
            </p>
          ) : !current ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[15px] leading-[22px] text-muted-foreground">
                Nothing due right now. The next one is in {nextDaysAway(rows)}.
              </p>
              <Button variant="outline" size="sm" onClick={() => openTab("review")}>
                Check again
              </Button>
            </div>
          ) : (
            <ReviewCard
              key={current.id}
              row={current}
              remaining={queue?.length ?? 0}
              onRate={(gotIt) => void handleRate(gotIt)}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Signed out, saves live in this browser only. Worth saying once, because it is the one
 * behaviour that differs, and it explains why nothing follows the learner to another device.
 */
function GuestNote() {
  return (
    <p className="text-[15px] leading-[22px] text-muted-foreground">
      Saved in this browser.{" "}
      <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
        Sign in
      </Link>{" "}
      to keep them on your account.
    </p>
  );
}

/** "tomorrow", "in 3 days", used only when nothing is due. */
function nextDaysAway(rows: SavedRow[]) {
  if (rows.length === 0) return "a moment";

  const soonest = rows.reduce((min, row) => {
    const at = new Date(row.nextReviewAt).getTime();
    return at < min ? at : min;
  }, Number.POSITIVE_INFINITY);

  const days = Math.ceil((soonest - Date.now()) / DAY_MS);
  if (days <= 1) return "a day";
  return `${days} days`;
}

