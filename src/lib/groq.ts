import "server-only";

/**
 * The Groq call itself lives in `groq-client.ts` so that one-time scripts under
 * `scripts/` can reuse it. Only the route handlers need this guard: it keeps the
 * server-only `GROQ_API_KEY` from being pulled into a client bundle.
 */
export * from "@/lib/groq-client";