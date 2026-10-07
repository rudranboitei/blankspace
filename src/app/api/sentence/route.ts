import { askForJson, errorResponse } from "@/lib/gemini";
import { RETRY_SUFFIX, SENTENCE_SYSTEM_PROMPT, sentenceUserPrompt } from "@/lib/prompts";
import { sentenceRequestSchema, sentenceResponseSchema } from "@/lib/schema";
import { TOPIC_BRIEFS } from "@/lib/topics";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = sentenceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Pick a topic first.", code: "bad_request" },
      { status: 400 },
    );
  }

  try {
    const { sentence } = await askForJson({
      system: SENTENCE_SYSTEM_PROMPT,
      user: sentenceUserPrompt(TOPIC_BRIEFS[parsed.data.topic]),
      schema: sentenceResponseSchema,
      maxTokens: 300,
      temperature: 0.9,
      retrySuffix: RETRY_SUFFIX,
    });

    return Response.json({ sentence });
  } catch (error) {
    return errorResponse(error);
  }
}