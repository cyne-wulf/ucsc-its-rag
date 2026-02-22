export type ParagraphSegment = {
  text: string;
  anchor?: string;
  heading?: string;
  breadcrumbs?: string[];
};

export type Chunk = ParagraphSegment & {
  tokens: number;
};

export type ManifestEntry = {
  url: string;
  file: string;
  title?: string;
  updated?: string;
  fetchedAt: string;
  status: number;
  etag?: string | null;
};

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
