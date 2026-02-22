import { z } from "zod";

const DEFAULT_VECTOR_BACKEND =
  process.env.VERCEL === "1" ? "local" : "qdrant";

function normalizeVectorBackend(value?: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("local")) return "local";
  if (normalized.includes("qdrant")) return "qdrant";
  return undefined;
}

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),
  VECTOR_BACKEND: z.enum(["qdrant", "local"]).default(DEFAULT_VECTOR_BACKEND),
  INDEX_NAME: z.string().default("its-kb"),
  INDEX_VERSION: z.coerce.number().default(1),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  GEMINI_MODEL: z.string().default("models/gemini-2.5-flash"),
  RETRIEVAL_TOP_K: z.coerce.number().default(20),
  RETRIEVAL_THRESHOLD: z.coerce.number().default(0.25),
  CACHE_MAX_ENTRIES: z.coerce.number().default(256),
  CACHE_TTL_SECONDS: z.coerce.number().default(600),
  SYSTEM_PHONE_FALLBACK: z.string().default("999-999-9999"),
  ITS_TICKET_URL: z.string().default("https://its.ucsc.edu/help"),
  ACRONYM_MAP: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return {};
      try {
        return JSON.parse(value) as Record<string, string>;
      } catch {
        return {};
      }
    }),
});

function cleanEnvValue(value?: string | null) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

const rawEnv = {
  OPENAI_API_KEY: cleanEnvValue(process.env.OPENAI_API_KEY),
  GEMINI_API_KEY: cleanEnvValue(process.env.GEMINI_API_KEY),
  QDRANT_URL: cleanEnvValue(process.env.QDRANT_URL),
  QDRANT_API_KEY: cleanEnvValue(process.env.QDRANT_API_KEY),
  VECTOR_BACKEND:
    normalizeVectorBackend(cleanEnvValue(process.env.VECTOR_BACKEND)) ??
    (process.env.VERCEL === "1" ? "local" : undefined),
  INDEX_NAME: cleanEnvValue(process.env.INDEX_NAME),
  INDEX_VERSION: cleanEnvValue(process.env.INDEX_VERSION),
  EMBEDDING_MODEL: cleanEnvValue(process.env.EMBEDDING_MODEL),
  GEMINI_MODEL: cleanEnvValue(process.env.GEMINI_MODEL),
  RETRIEVAL_TOP_K: cleanEnvValue(process.env.RETRIEVAL_TOP_K),
  RETRIEVAL_THRESHOLD: cleanEnvValue(process.env.RETRIEVAL_THRESHOLD),
  CACHE_MAX_ENTRIES: cleanEnvValue(process.env.CACHE_MAX_ENTRIES),
  CACHE_TTL_SECONDS: cleanEnvValue(process.env.CACHE_TTL_SECONDS),
  SYSTEM_PHONE_FALLBACK: cleanEnvValue(process.env.SYSTEM_PHONE_FALLBACK),
  ITS_TICKET_URL: cleanEnvValue(process.env.ITS_TICKET_URL),
  ACRONYM_MAP: process.env.ACRONYM_MAP,
};

if (process.env.NODE_ENV === "test") {
  rawEnv.OPENAI_API_KEY ||= "test-openai-key";
  rawEnv.GEMINI_API_KEY ||= "test-gemini-key";
}

export const env = envSchema.parse(rawEnv);
