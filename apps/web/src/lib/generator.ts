import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "./env";
import { logInfo, logError } from "./logger";
import { RagError } from "./errors";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

const FALLBACK_MODEL = "models/gemini-2.5-flash";

function normalizeModelName(name: string) {
  return name.startsWith("models/") ? name : `models/${name}`;
}

function parseGeminiError(error: unknown) {
  const status =
    typeof error === "object" && error !== null
      ? Number(
          (error as { status?: number; cause?: { status?: number } }).status ??
            (error as { status?: number; cause?: { status?: number } }).cause
              ?.status,
        )
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown Gemini error";
  return {
    status: Number.isFinite(status) ? status : undefined,
    message,
  };
}

async function callGemini(modelName: string, prompt: string) {
  const llm = genAI.getGenerativeModel({
    model: normalizeModelName(modelName),
  });
  const result = await llm.generateContent(prompt);
  return result.response.text() ?? "";
}

export async function generateAnswer(prompt: string) {
  const primaryModel = normalizeModelName(env.GEMINI_MODEL);
  try {
    return await callGemini(primaryModel, prompt);
  } catch (error) {
    const { status, message } = parseGeminiError(error);

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

    if (status === 400 || /invalid model/i.test(message)) {
      logError("gemini.invalid_model", {
        model: primaryModel,
        message,
      });
      throw new RagError({
        code: "gemini_invalid_model",
        message:
          "Gemini rejected the configured model. Set GEMINI_MODEL to a valid model ID such as gemini-2.5-flash.",
        status: 502,
        details: {
          model: primaryModel,
          geminiMessage: message,
        },
      });
    }

    if (status === 401 || status === 403) {
      logError("gemini.auth_failed", { message, status });
      throw new RagError({
        code: "gemini_auth_error",
        message:
          "Gemini rejected the API key or the project lacks access to the selected model. Rotate GEMINI_API_KEY or verify its permissions in Google AI Studio.",
        status: 401,
        details: {
          model: primaryModel,
          status,
          geminiMessage: message,
        },
      });
    }

    if (status === 429) {
      logError("gemini.rate_limited", { message });
      throw new RagError({
        code: "gemini_rate_limit",
        message:
          "Gemini rate limited this request. Try again in a few seconds or upgrade the quota for the configured key.",
        status: 429,
        details: {
          model: primaryModel,
          geminiMessage: message,
        },
      });
    }

    if (status && status >= 500) {
      logError("gemini.unavailable", { message, status });
      throw new RagError({
        code: "gemini_unavailable",
        message:
          "Gemini is temporarily unavailable. Vercel will retry automatically; if the problem persists open the Google Cloud status page.",
        status: 502,
        details: {
          model: primaryModel,
          status,
          geminiMessage: message,
        },
      });
    }

    logError("gemini.unhandled_error", {
      message,
      status,
    });
    throw new RagError({
      code: "gemini_unknown_error",
      message:
        "Gemini returned an unexpected error. Check the Vercel function logs for gemini.unhandled_error and verify the deployment env variables.",
      status: 502,
      details: {
        model: primaryModel,
        status,
        geminiMessage: message,
      },
    });
  }
}
