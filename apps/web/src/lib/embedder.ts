import OpenAI from "openai";
import { env } from "./env";
import { normalizeQuery } from "./normalize";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

export async function embedQuery(query: string) {
  const normalized = normalizeQuery(query);
  const response = await openai.embeddings.create({
    model: env.EMBEDDING_MODEL,
    input: normalized,
  });
  return { vector: response.data[0].embedding, normalized };
}
