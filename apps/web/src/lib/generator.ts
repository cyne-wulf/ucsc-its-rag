import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "./env";
import { logInfo, logError } from "./logger";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

const FALLBACK_MODEL = "models/gemini-2.5-flash";

function normalizeModelName(name: string) {
  return name.startsWith("models/") ? name : `models/${name}`;
}

async function callGemini(modelName: string, prompt: string) {
  const llm = genAI.getGenerativeModel({
    model: normalizeModelName(modelName),
  });
  const result = await llm.generateContent(prompt);
  return result.response.text() ?? "";
}

export async function generateAnswer(prompt: string) {
  const primaryModel = env.GEMINI_MODEL;
  try {
    return await callGemini(primaryModel, prompt);
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: number }).status)
        : undefined;
    if (status === 404 && primaryModel !== FALLBACK_MODEL) {
      logInfo("gemini.fallback", { from: primaryModel, to: FALLBACK_MODEL });
      try {
        return await callGemini(FALLBACK_MODEL, prompt);
      } catch (fallbackError) {
        logError("gemini.fallback_failed", {
          message:
            fallbackError instanceof Error
              ? fallbackError.message
              : String(fallbackError),
        });
        throw fallbackError;
      }
    }
    throw error;
  }
}
