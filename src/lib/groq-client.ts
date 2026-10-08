import { z } from "zod";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = envValue("GROQ_MODEL", "openai/gpt-oss-20b");
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;
/**
 * Waits before each retry after a 429: one second, two, then four. Past the last one the
 * learner gets the message rather than the request hanging.
 */
const RATE_LIMIT_BACKOFF_MS = [1_000, 2_000, 4_000] as const;
/** Low keeps the reasoning tokens small. These replies are short and formatted. */
const REASONING_EFFORT = "low";

/** An empty value in .env.local counts as unset. */
function envValue(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

type GroqErrorBody = { error?: { message?: string; code?: string } };

/** Error we own, so route handlers can map it to a status and a message a learner can act on. */
export class CoachError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CoachError";
  }
}

/** Pull the first JSON object out of a reply that may be wrapped in fences or prose. */
function extractJson(raw: string): unknown {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1]?.trim() ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** One call to Groq. JSON mode is enforced by the API, the shape by Zod. */
async function generateJsonText({
  system,
  user,
  maxTokens,
  temperature,
}: {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}) {
  const apiKey = envValue("GROQ_API_KEY", "");
  if (!apiKey) {
    throw new CoachError(
      500,
      "missing_api_key",
      "The server is missing GROQ_API_KEY. Add it to .env.local and restart the dev server.",
    );
  }

  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  };
  // Only the gpt-oss family takes this. Other models reject the field outright.
  if (MODEL.startsWith("openai/gpt-oss")) body.reasoning_effort = REASONING_EFFORT;

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw toCoachError(error);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { completion_tokens?: number };
  } & GroqErrorBody;

  if (!response.ok) {
    const message = payload.error?.message ?? `Groq replied with ${response.status}.`;
    console.error("[groq] api error:", response.status, payload.error?.code, message);

    // Groq rejects the whole call when the answer is not JSON. That is worth one retry.
    if (payload.error?.code === "json_validate_failed") {
      throw new CoachError(502, "bad_model_reply", "The reply was not JSON. Try again.");
    }

    throw statusToCoachError(response.status, message);
  }

  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") {
    console.error("[groq] reply hit max_tokens at", payload.usage?.completion_tokens);
    throw new CoachError(502, "bad_model_reply", "The reply was cut short. Try again.");
  }
  if (choice?.finish_reason && choice.finish_reason !== "stop") {
    throw new CoachError(422, "blocked", "Groq stopped before it could answer. Try again in a moment.");
  }

  return choice?.message?.content ?? "";
}

function statusToCoachError(status: number, message: string): CoachError {
  if (status === 429) {
    return new CoachError(429, "rate_limited", "Too many requests just now. Wait a moment and try again.");
  }
  if (status === 401 || status === 403) {
    return new CoachError(
      500,
      "bad_api_key",
      "The server's Groq API key was rejected. Check GROQ_API_KEY in .env.local.",
    );
  }
  if (status === 404) {
    return new CoachError(500, "bad_model", `Groq does not know the model in GROQ_MODEL. ${message}`);
  }
  if (status === 503 || status === 500 || status === 502) {
    return new CoachError(503, "overloaded", "Groq is busy right now. Try again in a moment.");
  }
  if (status === 413) {
    return new CoachError(413, "too_long", "That answer was too long. Shorten it and try again.");
  }
  return new CoachError(502, "upstream_error", "Groq couldn't complete that request. Try again.");
}

/** Turn SDK and network failures into a status and a message the UI can show as is. */
export function toCoachError(error: unknown): CoachError {
  if (error instanceof CoachError) return error;

  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new CoachError(504, "timeout", "That took too long. Check your connection and try again.");
  }

  console.error("[groq] unexpected error:", error);
  return new CoachError(500, "unknown", "Something went wrong on the server. Try again.");
}

/** Variations are plain sentences. Small models like to leave braces in them anyway. */
function tidy<T>(value: T): T {
  const feedback = value as { variations?: unknown };
  if (Array.isArray(feedback.variations)) {
    feedback.variations = feedback.variations.map((line) => String(line).replace(/[{}]/g, ""));
  }
  return value;
}

/**
 * Ask Groq for JSON and validate it with Zod. One retry with a stricter nudge and a
 * bigger token budget, because the shape matters more than the wording.
 */
export async function askForJson<T>({
  system,
  user,
  schema,
  maxTokens,
  temperature,
  retrySuffix,
}: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  temperature: number;
  retrySuffix: string;
}): Promise<T> {
  // Two budgets, because they answer different questions. A reply of the wrong shape is
  // retried with a stricter instruction; a 429 is waited out without touching the prompt,
  // so the two must not spend from the same allowance.
  let shapeAttempts = 0;
  let rateLimitRetries = 0;

  for (;;) {
    const isRetry = shapeAttempts > 0;

    let text: string;
    try {
      text = await generateJsonText({
        system,
        user: isRetry ? `${user}${retrySuffix}` : user,
        maxTokens: isRetry ? maxTokens * 2 : maxTokens,
        temperature,
      });
    } catch (error) {
      const coachError = toCoachError(error);

      // A rate limit is not the learner's fault and usually clears in seconds, so it is
      // worth waiting out: 1s, then 2s, then 4s. After that, hand the message back.
      if (coachError.code === "rate_limited") {
        const wait = RATE_LIMIT_BACKOFF_MS[rateLimitRetries];
        if (wait === undefined) throw coachError;

        rateLimitRetries++;
        console.error(`[groq] rate limited, retrying in ${wait}ms`);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }

      shapeAttempts++;
      if (coachError.code !== "bad_model_reply" || shapeAttempts >= MAX_ATTEMPTS) {
        throw coachError;
      }
      continue;
    }

    const parsed = schema.safeParse(extractJson(text));
    if (parsed.success) return tidy(parsed.data);

    const issue = parsed.error.issues[0];
    console.error(
      "[groq] reply failed validation:",
      issue?.path?.join(".") || "(no path)",
      "-",
      issue?.message ?? "the reply did not match the expected shape",
    );

    shapeAttempts++;
    if (shapeAttempts >= MAX_ATTEMPTS) break;
  }

  throw new CoachError(
    502,
    "bad_model_reply",
    "The reply came back in an unexpected shape. Try again.",
  );
}

export function errorResponse(error: unknown) {
  const coachError = toCoachError(error);
  return Response.json(
    { error: coachError.message, code: coachError.code },
    { status: coachError.status },
  );
}