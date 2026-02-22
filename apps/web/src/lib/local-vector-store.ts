import type { ChunkPayload, RetrievedChunk } from "./types";
import { env } from "./env";
import vectorStore from "../../vector-store/vector-store.json";

const VECTOR_DIMENSION = vectorStore.dimension;

type VectorStoreEntry = {
  id: string;
  vector: number[];
  vectorNorm?: number;
  payload: ChunkPayload;
};

type PreparedEntry = {
  id: string;
  vector: Float32Array;
  norm: number;
  payload: ChunkPayload;
};

function vectorNorm(values: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function dotProduct(a: ArrayLike<number>, b: ArrayLike<number>) {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

const preparedEntries: PreparedEntry[] = (vectorStore.entries as VectorStoreEntry[])
  .filter((entry) => Array.isArray(entry.vector) && entry.vector.length === VECTOR_DIMENSION)
  .map((entry) => {
    const vector = new Float32Array(entry.vector);
    const norm = entry.vectorNorm && entry.vectorNorm > 0 ? entry.vectorNorm : vectorNorm(vector);
    return { id: entry.id, vector, norm, payload: entry.payload };
  });

const entryMap = new Map(preparedEntries.map((entry) => [entry.id, entry]));

export function isLocalVectorStoreReady() {
  return preparedEntries.length > 0;
}

export async function searchLocal(vector: number[]): Promise<RetrievedChunk[]> {
  if (!preparedEntries.length || !vector.length) {
    return [];
  }

  const queryNorm = vectorNorm(vector);
  if (!Number.isFinite(queryNorm) || queryNorm === 0) {
    return [];
  }

  const scored = preparedEntries.map((entry) => {
    const denom = entry.norm * queryNorm;
    const score = denom > 0 ? dotProduct(vector, entry.vector) / denom : 0;
    return { entry, score };
  });

  const filtered = scored
    .filter((item) => item.score >= env.RETRIEVAL_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, env.RETRIEVAL_TOP_K)
    .map((item) => ({
      id: item.entry.id,
      score: item.score,
      payload: item.entry.payload,
    }));

  return filtered;
}

export async function getLocalChunkPayload(id: string): Promise<ChunkPayload | null> {
  if (!id) return null;
  return entryMap.get(id)?.payload ?? null;
}
