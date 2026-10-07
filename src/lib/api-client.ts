import type { Feedback, SentenceResponse } from "@/lib/schema";
import type { Topic } from "@/lib/topics";

/** Thrown for anything the UI should show as a sentence: network trouble, rate limits, bad shape. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new RequestError("Couldn't reach the server. Check your connection and try again.");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new RequestError(
      typeof data?.error === "string" && data.error
        ? data.error
        : "Something went wrong on the server. Try again.",
      response.status,
    );
  }

  return data as T;
}

export function fetchSentence(topic: Topic) {
  return postJson<SentenceResponse>("/api/sentence", { topic });
}

export function checkAnswer(input: { topic: Topic; hindi: string; userAnswer: string }) {
  return postJson<Feedback>("/api/check", input);
}