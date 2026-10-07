import "server-only";

import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";

/** An empty value in .env.local counts as unset. */
function envValue(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

const MODEL = envValue("GEMINI_MODEL", "gemini-3.5-flash");
/** Used once when the main model is out of capacity, which happens often. */
const FALLBACK_MODEL = "gemini-3.5-flash";
const TIMEOUT_MS = 30_000;

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

let client: GoogleGenAI | null = null;

function getClient() {
  const apiKey = envValue("GEMINI_API_KEY", "");
  if (!apiKey) {
    throw new CoachError(
      500,
      "missing_api_key",
      "The server is missing GEMINI_API_KEY. Add it to .env.local and restart the dev server.",
    );
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
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

type GenerateArgs = {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
};

/** One call. JSON is enforced by the response mime type, the shape by Zod. */
async function generateJsonText({ system, user, maxTokens, temperature }: GenerateArgs) {
  const ai = getClient();
  const models = [MODEL];
  if (MODEL !== FALLBACK_MODEL) models.push(FALLBACK_MODEL);

  let lastError: CoachError | null = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
          // These answers are short and formatted. Thinking only burns latency here.
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        },
      });

      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP") {
        throw new CoachError(
          422,
          "blocked",
          "Gemini stopped before it could answer. Try again in a moment.",
        );
      }

      return response.text ?? "";
    } catch (error) {
      const coachError = toCoachError(error);
      // A busy model is worth one more try, anything else is not.
      if (coachError.code !== "overloaded") throw coachError;
      lastError = coachError;
    }
  }

  throw lastError ?? new CoachError(503, "overloaded", "Gemini is busy right now. Try again shortly.");
}

/**
 * Ask Gemini for JSON and validate it with Zod. One retry with a stricter nudge,
 * because the shape matters more than the wording.
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
  let lastProblem = "no JSON object in the reply";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await generateJsonText({
      system,
      user: attempt === 1 ? user : `${user}${retrySuffix}`,
      maxTokens,
      temperature,
    });

    const parsed = schema.safeParse(extractJson(text));
    if (parsed.success) return parsed.data;

    lastProblem = parsed.error.issues[0]?.message ?? "the reply did not match the expected shape";
  }

  console.error("[gemini] unusable reply:", lastProblem);
  throw new CoachError(
    502,
    "bad_model_reply",
    "The reply came back in an unexpected shape. Try again.",
  );
}

/** Turn SDK and network failures into a status and a message the UI can show as is. */
export function toCoachError(error: unknown): CoachError {
  if (error instanceof CoachError) return error;

  if (error instanceof ApiError) {
    const { status, message } = error;
    console.error("[gemini] api error:", status, message);

    if (status === 429) {
      return new CoachError(429, "rate_limited", "Too many requests just now. Wait a moment and try again.");
    }
    if (status === 403 || status === 401) {
      return new CoachError(
        500,
        "bad_api_key",
        "The server's Gemini API key was rejected. Check GEMINI_API_KEY in .env.local.",
      );
    }
    if (status === 404) {
      return new CoachError(500, "bad_model", `Gemini does not know the model in GEMINI_MODEL.`);
    }
    if (status === 503 || status === 500 || status === 502) {
      return new CoachError(503, "overloaded", "Gemini is busy right now. Try again in a moment.");
    }
    if (status === 400) {
      return new CoachError(502, "bad_request_to_model", "Gemini rejected that request. Try again.");
    }
    return new CoachError(502, "upstream_error", "Gemini couldn't complete that request. Try again.");
  }

  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new CoachError(504, "timeout", "That took too long. Check your connection and try again.");
  }

  console.error("[gemini] unexpected error:", error);
  return new CoachError(500, "unknown", "Something went wrong on the server. Try again.");
}

export function errorResponse(error: unknown) {
  const coachError = toCoachError(error);
  return Response.json(
    { error: coachError.message, code: coachError.code },
    { status: coachError.status },
  );
}