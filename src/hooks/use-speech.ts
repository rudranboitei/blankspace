"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * `{braces}` mark a slot for reading. The recogniser would say them out as punctuation,
 * so they come off before anything reaches the synthesiser.
 */
export function speakable(text: string) {
  return text
    .replace(/\{([^{}]+)\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return "speechSynthesis" in window ? window.speechSynthesis : null;
}

function getSupport() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * The voice list arrives asynchronously in most browsers. Cached once it is there, and
 * left empty until then: the utterance still speaks, using the lang we set on it.
 */
let voices: SpeechSynthesisVoice[] = [];

function loadVoices() {
  const synth = getSynth();
  if (!synth || voices.length > 0) return voices;
  voices = synth.getVoices();
  return voices;
}

/** A local en-US voice reads the clearest, then any local English one, then any English. */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const available = loadVoices();
  const english = available.filter((voice) => voice.lang.toLowerCase().startsWith("en"));

  return (
    english.find((voice) => voice.localService && /^en[-_]us/i.test(voice.lang)) ??
    english.find((voice) => voice.localService) ??
    english[0]
  );
}

const subscribe = () => () => {};

/**
 * Reads a phrase out loud. Support never changes at runtime, so it is read once.
 * Calling `speak` again replaces whatever was playing rather than queueing behind it.
 */
export function useSpeech() {
  const isSupported = useSyncExternalStore(subscribe, getSupport, () => false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupported) return;

    const synth = getSynth();
    if (!synth) return;

    // Chrome hands the list over on this event rather than at first call.
    synth.addEventListener("voiceschanged", loadVoices);
    loadVoices();
    return () => synth.removeEventListener("voiceschanged", loadVoices);
  }, [isSupported]);

  const stop = useCallback(() => {
    const synth = getSynth();
    if (!synth) return;
    synth.cancel();
    setIsSpeaking(false);
  }, []);

  // A phrase left talking over the next screen is worse than no sound at all.
  useEffect(() => () => getSynth()?.cancel(), []);

  const speak = useCallback((text: string) => {
    const synth = getSynth();
    const clean = speakable(text);

    if (!synth) {
      setError("This browser can't read the phrase out loud.");
      return;
    }
    if (!clean) return;

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "en-US";
    // A little slower than natural, which is the point for a learner.
    utterance.rate = 0.95;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;

    const finish = () => setIsSpeaking(false);
    utterance.onend = finish;
    utterance.onerror = () => {
      finish();
      setError("Couldn't play the audio. Read it instead.");
    };

    setError(null);
    setIsSpeaking(true);
    synth.speak(utterance);
  }, []);

  return { isSupported, isSpeaking, error, speak, stop };
}