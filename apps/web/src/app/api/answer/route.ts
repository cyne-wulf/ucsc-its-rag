import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { answerQuestion } from "@/lib/rag";
import { logError, logInfo } from "@/lib/logger";

const bodySchema = z.object({
  question: z.string().min(4).max(2000),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const payload = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid question" },
      { status: 400 },
    );
  }

  try {
    const result = await answerQuestion(parsed.data.question);
    const latency = Math.round(performance.now() - startedAt);
    result.metadata.latencyMs = latency;
    logInfo("api.answer.success", {
      latency_ms: latency,
      sources: result.sources.length,
      cached: result.metadata.cached,
    });
    return NextResponse.json(result);
  } catch (error) {
    logError("api.answer.error", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Unable to generate an answer at this time." },
      { status: 500 },
    );
  }
}
