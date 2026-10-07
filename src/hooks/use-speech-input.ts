"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Minimal shape of the Web Speech API we use. The DOM lib only ships the
 * result types, so the recogniser itself is declared here.
 */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionResultEventLike = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; length: number; [index: number]: { transcript: string } };
  };
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognizerCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function getRecognizer(): SpeechRecognitionLike | null {
  const Ctor = getRecognizerCtor();
  if (!Ctor) return null;
  const recognizer = new Ctor();
  recognizer.lang = "en-US";
  recognizer.continuous = false;
  recognizer.interimResults = true;
  return recognizer;
}

const MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in your browser settings.",
  "service-not-allowed": "Microphone access was blocked. Allow it in your browser settings.",
  "no-speech": "Didn't catch that. Try the mic again.",
  network: "Speech recognition needs a connection. Type your answer instead.",
  aborted: "Stopped listening.",
};

/** Browser support never changes at runtime, so it is read once and shared. */
let support: boolean | null = null;

function getSupport() {
  support ??= getRecognizerCtor() !== null;
  return support;
}

const subscribe = () => () => {};

/**
 * Optional input only: the textarea is always editable by hand.
 * `onFinalText` fires with the full transcript each time a final result lands.
 */
export function useSpeechInput(onFinalText: (transcript: string) => void) {
  const isSupported = useSyncExternalStore(subscribe, getSupport, () => false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTextRef = useRef("");
  const onFinalTextRef = useRef(onFinalText);

  useEffect(() => {
    onFinalTextRef.current = onFinalText;
  }, [onFinalText]);

  useEffect(() => {
    return () => {
      recognizerRef.current?.abort();
      recognizerRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognizerRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (recognizerRef.current) return;

    const recognizer = getRecognizer();
    if (!recognizer) {
      setError("This browser can't listen. Type your answer instead.");
      return;
    }

    recognizerRef.current = recognizer;
    finalTextRef.current = "";
    setError(null);

    recognizer.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTextRef.current += `${transcript} `;
        } else {
          interim += transcript;
        }
      }
      const finalText = finalTextRef.current.trim();
      onFinalTextRef.current(finalText || interim);
    };

    recognizer.onerror = (event) => {
      setError(MESSAGES[event.error] ?? "Couldn't hear that. Type your answer instead.");
      setIsListening(false);
    };

    recognizer.onend = () => {
      recognizerRef.current = null;
      setIsListening(false);
    };

    try {
      recognizer.start();
      setIsListening(true);
    } catch {
      recognizerRef.current = null;
      setIsListening(false);
      setError("Couldn't start the mic. Try again.");
    }
  }, []);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  return { isSupported, isListening, error, start, stop, toggle };
}