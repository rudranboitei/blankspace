import { explainReplySchema, verifyReplySchema, type CoachReply } from "@/lib/schema";

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

/**
 * The reply is cached server side, in `explanations`, keyed by sentence and a hash of the
 * normalised answer. There is deliberately no browser-side cache: it would only hide the
 * same row, and it could not be shared across devices.
 */
export function askCoach(input: {
  sentenceId: string;
  answer: string;
  mode: "explain" | "verify";
}) {
  return fetch("/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sentenceId: input.sentenceId,
      answer: input.answer,
      mode: input.mode,
    }),
  }).then(async (response) => {
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        typeof (data as { error?: unknown })?.error === "string"
          ? (data as { error: string }).error
          : "Couldn't reach the coach. Try again.";
      throw new RequestError(message, response.status);
    }

    // Checked on the way back in: a cached row can be older than the schema.
    const payload = data as Record<string, unknown> | null;
    const kind = payload?.kind;
    const schema = kind === "verify" ? verifyReplySchema : explainReplySchema;
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new RequestError(
        "The coach replied in an unexpected shape. Try again.",
        response.status,
      );
    }

    return { ...parsed.data, kind: input.mode } as CoachReply;
  });
}