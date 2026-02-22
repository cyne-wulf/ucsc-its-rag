import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string(),
  GEMINI_API_KEY: z.string(),
  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),
  INDEX_NAME: z.string().default("its-kb"),
  INDEX_VERSION: z.coerce.number().default(1),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  GEMINI_MODEL: z.string().default("models/gemini-1.5-flash"),
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

const rawEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  QDRANT_URL: process.env.QDRANT_URL,
  QDRANT_API_KEY: process.env.QDRANT_API_KEY,
  INDEX_NAME: process.env.INDEX_NAME,
  INDEX_VERSION: process.env.INDEX_VERSION,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  RETRIEVAL_TOP_K: process.env.RETRIEVAL_TOP_K,
  RETRIEVAL_THRESHOLD: process.env.RETRIEVAL_THRESHOLD,
  CACHE_MAX_ENTRIES: process.env.CACHE_MAX_ENTRIES,
  CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS,
  SYSTEM_PHONE_FALLBACK: process.env.SYSTEM_PHONE_FALLBACK,
  ITS_TICKET_URL: process.env.ITS_TICKET_URL,
  ACRONYM_MAP: process.env.ACRONYM_MAP,
};

if (process.env.NODE_ENV === "test") {
  rawEnv.OPENAI_API_KEY ||= "test-openai-key";
  rawEnv.GEMINI_API_KEY ||= "test-gemini-key";
}

export const env = envSchema.parse(rawEnv);
