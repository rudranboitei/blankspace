import { askForJson, errorResponse } from "@/lib/groq";
import { CHECK_SYSTEM_PROMPT, checkUserPrompt, RETRY_SUFFIX } from "@/lib/prompts";
import { checkRequestSchema, feedbackSchema } from "@/lib/schema";
import { TOPIC_BRIEFS } from "@/lib/topics";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = checkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: parsed.error.issues[0]?.message ?? "That request was incomplete.",
        code: "bad_request",
      },
      { status: 400 },
    );
  }

  const { topic, hindi, userAnswer } = parsed.data;

  try {
    const feedback = await askForJson({
      system: CHECK_SYSTEM_PROMPT,
      user: checkUserPrompt({ topicBrief: TOPIC_BRIEFS[topic], hindi, userAnswer }),
      schema: feedbackSchema,
      maxTokens: 900,
      temperature: 0.4,
      retrySuffix: RETRY_SUFFIX,
    });

    return Response.json(feedback);
  } catch (error) {
    return errorResponse(error);
  }
}