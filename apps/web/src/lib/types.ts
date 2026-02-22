export type ChunkPayload = {
  title: string;
  url: string;
  anchor?: string;
  breadcrumbs?: string[];
  updated?: string;
  tags?: string[];
  service?: string;
  platform?: string;
  audience?: string[];
  task?: string[];
  text: string;
  doc_hash: string;
  chunk_hash: string;
  index_version: number;
};

export type RetrievedChunk = {
  id: string;
  score: number;
  payload: ChunkPayload;
};

export type SourceDocument = {
  id: string;
  title: string;
  url: string;
  anchor?: string;
  breadcrumbs?: string[];
  updated?: string;
  snippet: string;
  score: number;
};

export type AnswerMetadata = {
  cached: boolean;
  refused: boolean;
  query: string;
  normalizedQuery: string;
  retrievalCount: number;
  retrievalTopK: number;
  indexVersion: number;
  latencyMs?: number;
};

export type AnswerResult = {
  answer: string;
  sources: SourceDocument[];
  metadata: AnswerMetadata;
  fallbackMessage?: string;
};
