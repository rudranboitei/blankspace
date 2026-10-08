/**
 * How many recent sentences to keep out of the draw, so a short topic cannot feel like a
 * loop. Kept per tab and dropped when the tab closes: a fresh visit should not inherit a
 * previous session's history. Isomorphic, and the window guard keeps it safe to import
 * from a module that is also rendered on the server.
 */
const RECENT_KEY = "pattern-practice:recent:v1";
const RECENT_SIZE = 10;

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function recentSentenceIds() {
  return read().slice(-RECENT_SIZE);
}

/** Most recent last, oldest dropped once the ring is full. */
export function rememberSentence(id: string) {
  if (typeof window === "undefined") return;

  const next = [...read().filter((seen) => seen !== id), id].slice(-RECENT_SIZE);
  try {
    window.sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode, or the quota is gone: the only cost is a repeat sentence.
  }
}

export function clearRecentSentences() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RECENT_KEY);
  } catch {
    // Nothing to do.
  }
}