"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { MicButton } from "@/components/mic-button";
import { PatternText } from "@/components/pattern-text";
import { ResultCard, type CoachState } from "@/components/result-card";
import { TopicTabs } from "@/components/topic-tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useSavedPatterns } from "@/hooks/use-saved-patterns";
import { useSpeech } from "@/hooks/use-speech";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { fetchRandomSentence } from "@/lib/bank";
import { askCoach, RequestError } from "@/lib/coach";
import { logAttempt } from "@/lib/attempts";
import { hintFor, matchAnswer, type BankItem } from "@/lib/match";
import { DEFAULT_TOPIC, type Topic } from "@/lib/topics";

const IDLE_COACH: CoachState = { status: "idle", data: null, error: null };

export function PracticeScreen() {
  const [topic, setTopic] = useState<Topic>(DEFAULT_TOPIC);
  const [item, setItem] = useState<BankItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [isHintShown, setIsHintShown] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [coach, setCoach] = useState<CoachState>(IDLE_COACH);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const library = useSavedPatterns();
  const speech = useSpeechInput(setAnswer);
  const voice = useSpeech();

  /**
   * The synthesiser would otherwise be transcribed straight back into the textarea, so
   * anything still talking is stopped the moment the mic opens.
   */
  const toggleMic = useCallback(() => {
    if (!speech.isListening) voice.stop();
    speech.toggle();
  }, [speech, voice]);

  const resetFor = (nextItem: BankItem | null) => {
    setItem(nextItem);
    setAnswer("");
    setIsHintShown(false);
    setIsChecked(false);
    setCoach(IDLE_COACH);
    setIsSaved(false);
    voice.stop();
    textareaRef.current?.focus();
  };


  /**
   * One sentence drawn from Postgres, with the last ten of this session left out.
   *
   * Random reads live in effects and handlers, never in render: Cache Components treats a
   * random read while prerendering as an unstable value.
   */
  const draw = useCallback(
    async (from: Topic) => {
      try {
        const next = await fetchRandomSentence(from);
        if (!next) {
          setItem(null);
          setLoadError("This topic has no sentences yet. Run bun run seed.");
          return;
        }
        resetFor(next);
      } catch {
        setItem(null);
        setLoadError("Couldn't load the sentences. Try again.");
      }
    },
    // resetFor only touches state and the textarea, and is stable enough not to matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    let live = true;

    // isLoading starts true and handleTopicChange resets it, so there is no setState in the
    // body of this effect: it only starts work and reports back.
    void fetchRandomSentence(topic)
      .then((next) => {
        if (!live) return;
        if (!next) {
          setItem(null);
          setLoadError("This topic has no sentences yet. Run bun run seed.");
          return;
        }
        setItem(next);
      })
      .catch(() => {
        if (!live) return;
        setItem(null);
        setLoadError("Couldn't load the sentences. Try again.");
      })
      .finally(() => {
        if (live) setIsLoading(false);
      });

    return () => {
      live = false;
    };
  }, [topic]);

  const handleTopicChange = (next: Topic) => {
    if (next === topic) return;
    resetFor(null);
    setLoadError(null);
    setIsLoading(true);
    setTopic(next);
  };

  const handleNext = () => {
    void draw(topic);
  };

  const handleRetry = () => {
    setLoadError(null);
    setIsLoading(true);
    void draw(topic);
  };

  const match = item && isChecked ? matchAnswer(answer, item) : null;

  /**
   * Grading is entirely local: normalize, compare against the accepted wordings, and diff
   * against the phrase. Nothing here reaches the network.
   */
  const handleCheck = useCallback(() => {
    if (!item) return;

    const trimmed = answer.trim();
    if (!trimmed) {
      toast.error("Write your English version first.");
      textareaRef.current?.focus();
      return;
    }

    setIsChecked(true);
    logAttempt({ sentenceId: item.id, userAnswer: trimmed, verdict: matchAnswer(trimmed, item).verdict });
  }, [answer, item]);

  const runCoach = useCallback(
    async (mode: "explain" | "verify") => {
      if (!item) return;

      setCoach({ status: "loading", data: null, error: null });
      try {
        const data = await askCoach({
          sentenceId: item.id,
          answer: answer.trim(),
          mode,
        });
        setCoach({ status: "ready", data, error: null });
      } catch (error) {
        setCoach({
          status: "error",
          data: null,
          error:
            error instanceof RequestError
              ? error.message
              : "Couldn't reach the coach. Try again.",
        });
      }
    },
    [item, answer],
  );

  const handleSave = useCallback(async () => {
    if (!item || isSaving) return;

    setIsSaving(true);
    try {
      // Signed in this goes to saved_patterns, signed out to localStorage. Both are one row
      // per sentence, so saving the same pattern again just records the new answer.
      await library.save({ sentence: item, userAnswer: answer.trim() });
      setIsSaved(true);
      toast.success(
        library.source === "account" ? "Pattern saved" : "Pattern saved on this device",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save that pattern. Try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [answer, isSaving, item, library]);

  const hint = item ? hintFor(item) : "";
  const canHint = Boolean(hint) && !isHintShown && !isLoading && !isChecked;

  return (
    <div className="flex flex-col gap-6">
      <TopicTabs value={topic} onChange={handleTopicChange} disabled={false} />

      <section className="flex flex-col gap-2">
        <p className="text-[13px] leading-[18px] text-muted-foreground">Say this in English</p>

        {isLoading ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-2/3" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[15px] leading-[22px] text-fix">{loadError}</p>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              Try again
            </Button>
          </div>
        ) : (
          <p className="font-sans text-xl leading-[30px] font-medium">{item?.hindi}</p>
        )}
      </section>

      <div className="flex flex-col gap-3">
        {isHintShown && hint ? (
          <p className="text-[13px] leading-[18px] text-muted-foreground">
            Starts with{" "}
            <PatternText text={hint} className="font-serif text-[15px] leading-[22px] text-foreground" />
          </p>
        ) : null}

        <label htmlFor="english-answer" className="sr-only">
          Your English version
        </label>
        <Textarea
          id="english-answer"
          ref={textareaRef}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              setIsChecked(true);
            }
          }}
          placeholder="Type or speak your English version"
          rows={3}
          maxLength={600}
        />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            {speech.isSupported && (
              <MicButton
                isListening={speech.isListening}
                disabled={isLoading}
                onToggle={toggleMic}
              />
            )}
            {speech.isListening ? (
              <span className="text-[13px] leading-[18px] text-muted-foreground">Listening</span>
            ) : null}
            {/* Stuck before answering: reveal the opening, not the answer. */}
            {canHint ? (
              <Button variant="ghost" size="sm" onClick={() => setIsHintShown(true)}>
                Hint
              </Button>
            ) : null}
          </div>

          <Button onClick={handleCheck} disabled={isLoading || !answer.trim()}>
            Check answer
          </Button>
        </div>

        {speech.error ? (
          <p role="status" className="text-[13px] leading-[18px] text-fix">
            {speech.error}
          </p>
        ) : null}
      </div>

      {item && match ? (
        <ResultCard
          key={`${item.id}:${isChecked}`}
          item={item}
          answer={answer.trim()}
          match={match}
          isSaved={isSaved}
          isSpeaking={voice.isSpeaking}
          coach={coach}
          onToggleListen={() => {
            if (voice.isSpeaking) {
              voice.stop();
              return;
            }
            const coached = coach.data?.kind === "explain" ? coach.data.correctPhrase : "";
            voice.speak(coached || item.correctPhrase);
          }}
          onExplain={() => void runCoach("explain")}
          onVerify={() => void runCoach("verify")}
          onSave={() => void handleSave()}
          isSaving={isSaving}
          onNext={handleNext}
        />
      ) : null}
    </div>
  );
}
