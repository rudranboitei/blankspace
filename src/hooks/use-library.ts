"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { Topic } from "@/lib/topics";

const STORAGE_KEY = "pattern-practice:library:v1";

export type SavedPattern = {
  id: string;
  topic: Topic;
  hindi: string;
  correctPhrase: string;
  pattern: string;
  variations: [string, string];
  note: string;
  savedAt: number;
};

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: SavedPattern[] | null = null;

function isSavedPattern(value: unknown): value is SavedPattern {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.hindi === "string" &&
    typeof item.correctPhrase === "string" &&
    typeof item.pattern === "string" &&
    typeof item.note === "string" &&
    Array.isArray(item.variations) &&
    item.variations.length === 2
  );
}

function read(): SavedPattern[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isSavedPattern) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: SavedPattern[]) {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: the session still works, it just won't persist.
  }
  for (const listener of listeners) listener();
}

/** Another tab wrote to the key, so the cached copy is stale. */
function handleStorageEvent() {
  cache = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", handleStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", handleStorageEvent);
    }
  };
}

const EMPTY: SavedPattern[] = [];

export function useLibrary() {
  const patterns = useSyncExternalStore(subscribe, read, () => EMPTY);

  const save = useCallback(
    (input: Omit<SavedPattern, "id" | "savedAt">) => {
      const current = read();
      const duplicate = current.some(
        (item) => item.correctPhrase.toLowerCase() === input.correctPhrase.toLowerCase(),
      );
      if (duplicate) return false;

      const next: SavedPattern = {
        ...input,
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        savedAt: Date.now(),
      };
      write([next, ...current]);
      return true;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    write(read().filter((item) => item.id !== id));
  }, []);

  const restore = useCallback((pattern: SavedPattern) => {
    const current = read();
    if (current.some((item) => item.id === pattern.id)) return;
    write([pattern, ...current]);
  }, []);

  return { patterns, save, remove, restore };
}