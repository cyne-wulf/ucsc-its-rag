import { env } from "./env";
import type { ChunkPayload, RetrievedChunk } from "./types";
import { searchQdrant, getChunkPayload as getQdrantPayload } from "./qdrant";
import { searchLocal, getLocalChunkPayload } from "./local-vector-store";
import { RagError } from "./errors";
import { logError } from "./logger";

const backend = env.VECTOR_BACKEND;

function vectorError(action: string, error: unknown): never {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";

  logError(`vector.${action}.failed`, {
    backend,
    message,
    target: backend === "qdrant" ? env.QDRANT_URL : "local-json",
  });

  if (backend === "qdrant") {
    throw new RagError({
      code: "qdrant_unreachable",
      message: `Unable to reach Qdrant at ${env.QDRANT_URL}. Ensure the service is accessible from Vercel or switch VECTOR_BACKEND=local.`,
      status: 503,
      details: {
        backend,
        url: env.QDRANT_URL,
      },
    });
  }

  throw new RagError({
    code: "local_vector_missing",
    message:
      "Local vector-store is missing or unreadable. Re-run `pnpm --filter scripts run build-index` before deploying.",
    status: 500,
    details: {
      backend,
    },
  });
}

export async function searchChunks(vector: number[]): Promise<RetrievedChunk[]> {
  try {
    if (backend === "local") {
      return await searchLocal(vector);
    }
    return await searchQdrant(vector);
  } catch (error) {
    vectorError("search", error);
  }
}

export async function fetchChunkPayload(id: string): Promise<ChunkPayload | null> {
  try {
    if (backend === "local") {
      return await getLocalChunkPayload(id);
    }
    return await getQdrantPayload(id);
  } catch (error) {
    vectorError("payload", error);
  }
}
