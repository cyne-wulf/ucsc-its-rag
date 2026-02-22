import { env } from "./env";
import { embedQuery } from "./embedder";
import { generateAnswer } from "./generator";
import { LruCache } from "./cache";
import { hashObject } from "./hash";
import { logInfo } from "./logger";
import { cleanSnippet } from "./normalize";
import { buildPrompt } from "./prompt";
import { searchQdrant } from "./qdrant";
import type { AnswerResult, RetrievedChunk, SourceDocument } from "./types";

const retrievalCache = new LruCache<string, RetrievedChunk[]>(
  env.CACHE_MAX_ENTRIES,
  env.CACHE_TTL_SECONDS,
);

const answerCache = new LruCache<string, AnswerResult>(
  env.CACHE_MAX_ENTRIES,
  env.CACHE_TTL_SECONDS,
);

function hydrateSources(chunks: RetrievedChunk[]): SourceDocument[] {
  return chunks.map((chunk) => ({
    id: chunk.id,
    title: chunk.payload.title,
    url: chunk.payload.url,
    anchor: chunk.payload.anchor,
    breadcrumbs: chunk.payload.breadcrumbs,
    updated: chunk.payload.updated,
    snippet: cleanSnippet(chunk.payload.text),
    score: chunk.score,
  }));
}

export async function answerQuestion(question: string): Promise<AnswerResult> {
  const { vector, normalized } = await embedQuery(question);
  const retrievalKey = hashObject({
    query: normalized,
    index: env.INDEX_VERSION,
  });

  let retrieved = retrievalCache.get(retrievalKey);
  let retrievalCached = Boolean(retrieved);

  if (!retrieved) {
    retrieved = await searchQdrant(vector);
    retrievalCache.set(retrievalKey, retrieved);
    retrievalCached = false;
  }

  const topHits = hydrateSources(retrieved.slice(0, 5));
  const baseMetadata = {
    cached: false,
    refused: false,
    query: question,
    normalizedQuery: normalized,
    retrievalCount: retrieved.length,
    retrievalTopK: env.RETRIEVAL_TOP_K,
    indexVersion: env.INDEX_VERSION,
  };

  if (!topHits.length) {
    const fallback = `Sorry, I couldn't find an ITS KB page with information pertaining to your issue, but you could try searching the knowledge base directly. If that doesn't help, you can call our office at ${env.SYSTEM_PHONE_FALLBACK} or open a ticket at ${env.ITS_TICKET_URL}.`;
    const result: AnswerResult = {
      answer: fallback,
      sources: [],
      metadata: {
        ...baseMetadata,
        cached: retrievalCached,
        refused: true,
      },
      fallbackMessage: fallback,
    };
    return result;
  }

  const answerKey = hashObject({
    query: normalized,
    ids: topHits.map((hit) => hit.id),
    index: env.INDEX_VERSION,
  });

  const cachedAnswer = answerCache.get(answerKey);
  if (cachedAnswer) {
    return {
      ...cachedAnswer,
      metadata: {
        ...cachedAnswer.metadata,
        cached: true,
      },
    };
  }

  const prompt = buildPrompt(question, topHits);
  const completion = await generateAnswer(prompt);

  const answer = completion.trim();
  const fallbackMessage = `If that doesn't help, you can call our office at ${env.SYSTEM_PHONE_FALLBACK} or open a ticket at ${env.ITS_TICKET_URL}.`;

  const result: AnswerResult = {
    answer,
    sources: topHits,
    metadata: {
      ...baseMetadata,
      cached: false,
      refused: false,
    },
    fallbackMessage,
  };

  answerCache.set(answerKey, result);
  logInfo("rag.answer.generated", {
    retrieval_cached: retrievalCached,
    query: normalized,
    sources: topHits.length,
  });

  return result;
}
