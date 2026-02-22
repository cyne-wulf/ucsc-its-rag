import OpenAI from "openai";
import { env } from "./env";
import { normalizeQuery, augmentQuery } from "./normalize";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

export async function embedQuery(query: string) {
  const normalized = normalizeQuery(query);
  const augmented = augmentQuery(normalized);
  const response = await openai.embeddings.create({
    model: env.EMBEDDING_MODEL,
    input: augmented,
  });
  return { vector: response.data[0].embedding, normalized };
}
