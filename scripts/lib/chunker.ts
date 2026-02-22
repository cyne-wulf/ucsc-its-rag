import type { Chunk, ParagraphSegment } from "./types";

const DEFAULT_MIN_TOKENS = 180;
const DEFAULT_MAX_TOKENS = 360;
const DEFAULT_OVERLAP_RATIO = 0.15;

const TOKEN_ESTIMATE_DIVISOR = 4.2;

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / TOKEN_ESTIMATE_DIVISOR));
}

type ChunkerOptions = {
  minTokens?: number;
  maxTokens?: number;
  overlapRatio?: number;
};

export function chunkSegments(
  segments: ParagraphSegment[],
  opts: ChunkerOptions = {},
): Chunk[] {
  const minTokens = opts.minTokens ?? DEFAULT_MIN_TOKENS;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapRatio = opts.overlapRatio ?? DEFAULT_OVERLAP_RATIO;

  const chunks: Chunk[] = [];
  let buffer: ParagraphSegment[] = [];
  let bufferTokens = 0;

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.map((seg) => seg.text).join("\n\n").trim();
    if (!text) {
      buffer = [];
      bufferTokens = 0;
      return;
    }
    const anchor =
      buffer.find((seg) => Boolean(seg.anchor))?.anchor ?? undefined;
    const heading =
      buffer.find((seg) => Boolean(seg.heading))?.heading ?? undefined;
    const breadcrumbs =
      buffer.find((seg) => seg.breadcrumbs?.length)?.breadcrumbs ?? undefined;

    chunks.push({
      text,
      anchor,
      heading,
      breadcrumbs,
      tokens: estimateTokens(text),
    });

    if (overlapRatio > 0 && buffer.length > 1) {
      const keep = Math.max(1, Math.floor(buffer.length * overlapRatio));
      buffer = buffer.slice(-keep);
      bufferTokens = buffer.reduce(
        (acc, seg) => acc + estimateTokens(seg.text),
        0,
      );
    } else {
      buffer = [];
      bufferTokens = 0;
    }
  };

  for (const segment of segments) {
    const tokens = estimateTokens(segment.text);
    if (!segment.text.trim()) continue;

    if (!buffer.length) {
      buffer.push(segment);
      bufferTokens = tokens;
      continue;
    }

    if (bufferTokens + tokens > maxTokens) {
      if (bufferTokens >= minTokens) {
        flush();
        buffer.push(segment);
        bufferTokens = tokens;
        continue;
      }
      flush();
      buffer.push(segment);
      bufferTokens = tokens;
      continue;
    }

    buffer.push(segment);
    bufferTokens += tokens;
  }

  flush();
  return chunks;
}
