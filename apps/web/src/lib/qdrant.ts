import { QdrantClient } from "@qdrant/js-client-rest";
import type { Schemas } from "@qdrant/js-client-rest";
import { env } from "./env";
import type { ChunkPayload, RetrievedChunk } from "./types";

const client = new QdrantClient({
  url: env.QDRANT_URL,
  apiKey: env.QDRANT_API_KEY || undefined,
  timeout: 60000,
  checkCompatibility: false,
});

function mapPoint(point: Schemas["ScoredPoint"]): RetrievedChunk {
  const payload = point.payload as ChunkPayload;
  return {
    id: String(point.id ?? payload.chunk_hash),
    score: point.score ?? 0,
    payload,
  };
}

export async function searchQdrant(vector: number[]) {
  const result = await client.search(env.INDEX_NAME, {
    vector,
    with_payload: true,
    limit: env.RETRIEVAL_TOP_K,
    score_threshold: env.RETRIEVAL_THRESHOLD,
  });

  return result
    .map(mapPoint)
    .filter((item) => item.score >= env.RETRIEVAL_THRESHOLD);
}

export async function getChunkPayload(id: string) {
  if (!id) return null;
  const records = await client.retrieve(env.INDEX_NAME, {
    ids: [id],
    with_payload: true,
    with_vectors: false,
  });
  const record = records[0];
  if (!record?.payload) {
    return null;
  }
  return record.payload as ChunkPayload;
}
