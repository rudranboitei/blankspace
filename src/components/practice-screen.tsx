"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { MicButton } from "@/components/mic-button";
import { ResultCard } from "@/components/result-card";
import { TopicTabs } from "@/components/topic-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useLibrary } from "@/hooks/use-library";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { checkAnswer, fetchSentence, RequestError } from "@/lib/api-client";
import type { Feedback } from "@/lib/schema";
import { DEFAULT_TOPIC, type Topic } from "@/lib/topics";

type Result = {
  id: number;
  feedback: Feedback;
  userAnswer: string;
  isSaved: boolean;
};

type SentenceOutcome = { ok: true; sentence: string } | { ok: false; message: string };

async function requestSentence(topic: Topic): Promise<SentenceOutcome> {
  try {
    const { sentence } = await fetchSentence(topic);
    return { ok: true, sentence };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof RequestError ? error.message : "Couldn't load a sentence. Try again.",
    };
  }
}

export function PracticeScreen() {
  const [topic, setTopic] = useState<Topic>(DEFAULT_TOPIC);
  const [sentence, setSentence] = useState("");
  const [sentenceError, setSentenceError] = useState<string | null>(null);
  const [isLoadingSentence, setIsLoadingSentence] = useState(true);
  const [answer, setAnswer] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const { save } = useLibrary();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef(0);

  const speech = useSpeechInput(setAnswer);

  /** Drops replies from a request the learner has already moved on from. */
  const applySentence = useCallback((requestId: number, outcome: SentenceOutcome) => {
    if (requestRef.current !== requestId) return;
    if (outcome.ok) {
      setSentence(outcome.sentence);
      setSentenceError(null);
    } else {
      setSentence("");
      setSentenceError(outcome.message);
    }
    setIsLoadingSentence(false);
  }, []);

  const startLoading = useCallback((nextTopic: Topic) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    void requestSentence(nextTopic).then((outcome) => applySentence(requestId, outcome));
  }, [applySentence]);

  // The prompt sentence follows the topic: one sentence on mount, a fresh one per topic.
  useEffect(() => {
    startLoading(topic);
  }, [topic, startLoading]);

  const handleTopicChange = (next: Topic) => {
    if (next === topic) return;
    setTopic(next);
    setAnswer("");
    setResult(null);
    setSentence("");
    setSentenceError(null);
    setIsLoadingSentence(true);
  };

  const handleCheck = async () => {
    const userAnswer = answer.trim();
    if (!userAnswer || !sentence) {
      toast.error("Write your English version first.");
      textareaRef.current?.focus();
      return;
    }

    setIsChecking(true);
    try {
      const feedback = await checkAnswer({ topic, hindi: sentence, userAnswer });
      setResult({ id: Date.now(), feedback, userAnswer, isSaved: false });
    } catch (error) {
      toast.error(
        error instanceof RequestError
          ? error.message
          : "Couldn't check your answer. Try again.",
      );
    } finally {
      setIsChecking(false);
    }
  };

  const handleSave = () => {
    if (!result) return;

    const added = save({ topic, hindi: sentence, ...result.feedback });
    if (!added) {
      toast("That pattern is already in your library.");
      return;
    }

    setResult((previous) => (previous ? { ...previous, isSaved: true } : previous));
    toast.success("Pattern saved");
  };

  const retrySentence = () => {
    setIsLoadingSentence(true);
    startLoading(topic);
  };

  const handleNext = () => {
    setResult(null);
    setAnswer("");
    retrySentence();
    textareaRef.current?.focus();
  };

  const isBusy = isLoadingSentence || isChecking;

  return (
    <div className="flex flex-col gap-6">
      <TopicTabs value={topic} onChange={handleTopicChange} disabled={isChecking} />

      <section className="flex flex-col gap-2">
        <p className="text-[13px] leading-[18px] text-muted-foreground">Say this in English</p>

        {isLoadingSentence ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-2/3" />
          </div>
        ) : sentenceError ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[15px] leading-[22px] text-fix">{sentenceError}</p>
            <Button variant="outline" size="sm" onClick={retrySentence}>
              Next sentence
            </Button>
          </div>
        ) : (
          <p className="font-sans text-xl leading-[30px] font-medium">{sentence}</p>
        )}
      </section>

      <div className="flex flex-col gap-3">
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
              void handleCheck();
            }
          }}
          placeholder="Type or speak your English version"
          rows={3}
          maxLength={600}
        />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {speech.isSupported && (
              <MicButton
                isListening={speech.isListening}
                disabled={isBusy}
                onToggle={speech.toggle}
              />
            )}
            {speech.isListening && (
              <span className="text-[13px] leading-[18px] text-muted-foreground">Listening</span>
            )}
          </div>

          <Button onClick={() => void handleCheck()} disabled={isBusy}>
            {isChecking ? "Checking" : "Check answer"}
          </Button>
        </div>

        {speech.error && (
          <p role="status" className="text-[13px] leading-[18px] text-fix">
            {speech.error}
          </p>
        )}
      </div>

      {isChecking ? (
        <Card aria-busy="true">
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] leading-[18px] text-muted-foreground" role="status">
                Checking your answer
              </p>
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-7 w-1/2" />
            </div>
            <Skeleton className="h-7 w-5/6" />
            <Skeleton className="h-7 w-2/3" />
          </CardContent>
        </Card>
      ) : result ? (
        <ResultCard
          key={result.id}
          userAnswer={result.userAnswer}
          feedback={result.feedback}
          isSaved={result.isSaved}
          onSave={handleSave}
          onNext={handleNext}
        />
      ) : null}
    </div>
  );
}