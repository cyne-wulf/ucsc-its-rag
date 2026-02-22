#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import dotenv from "dotenv";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { chunkSegments } from "./lib/chunker";
import { extractFromHtml } from "./lib/html";
import { hashId, hashToUuid, sha256 } from "./lib/hash";
import { logError, logInfo } from "./lib/logger";
import type { ChunkPayload, ManifestEntry } from "./lib/types";

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env.local") });
dotenv.config({ path: path.join(ROOT, ".env") });
const KB_ROOT = process.env.KB_ROOT_DIR || path.join(ROOT, "data", "kb");
const RAW_DIR = process.env.KB_RAW_DIR || path.join(KB_ROOT, "raw");
const MANIFEST_PATH =
  process.env.KB_MANIFEST || path.join(KB_ROOT, "manifest.json");
const HISTORY_PATH = path.join(KB_ROOT, "ingest-history.json");

const INDEX_NAME = process.env.INDEX_NAME || "its-kb";
const INDEX_VERSION = Number(process.env.INDEX_VERSION || "1");
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE || "64");
const FALLBACK_BASE =
  process.env.KB_FALLBACK_BASE || "https://its.ucsc.edu/kb";
const args = new Set(process.argv.slice(2));

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY || undefined,
  timeout: 60000,
  checkCompatibility: false,
});

type HistoryRecord = Record<string, string>;

async function ensureCollection() {
  try {
    await qdrant.getCollection(INDEX_NAME);
  } catch {
    await qdrant.createCollection(INDEX_NAME, {
      vectors: {
        size: 1536,
        distance: "Cosine",
      },
      optimizers_config: {
        default_segment_number: 1,
      },
    });
  }
}

async function loadManifest(): Promise<Record<string, ManifestEntry>> {
  if (!existsSync(MANIFEST_PATH)) {
    return {};
  }
  const raw = await readFile(MANIFEST_PATH, "utf8");
  const entries = JSON.parse(raw) as ManifestEntry[];
  const map: Record<string, ManifestEntry> = {};
  entries.forEach((entry) => {
    map[path.join(ROOT, entry.file)] = entry;
  });
  return map;
}

async function loadHistory(): Promise<HistoryRecord> {
  if (!existsSync(HISTORY_PATH)) return {};
  const raw = await readFile(HISTORY_PATH, "utf8");
  return JSON.parse(raw) as HistoryRecord;
}

async function saveHistory(history: HistoryRecord) {
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2));
}

async function listHtmlFiles(): Promise<string[]> {
  const entries = await readdir(RAW_DIR);
  return entries
    .filter((file) => file.endsWith(".html"))
    .map((file) => path.join(RAW_DIR, file));
}

function buildPayloads(
  html: string,
  entry: ManifestEntry,
): { payloads: ChunkPayload[]; docHash: string } {
  const extracted = extractFromHtml(html);
  const docHash = sha256(html);
  const url = entry.url;
  const payloads: ChunkPayload[] = [];
  const chunks = chunkSegments(extracted.segments);

  chunks.forEach((chunk, index) => {
    const chunkHash = hashId([docHash, index, INDEX_VERSION]);
    payloads.push({
      title: extracted.title,
      url,
      anchor: chunk.anchor,
      breadcrumbs: chunk.breadcrumbs,
      updated: extracted.updated || entry.updated,
      text: chunk.text,
      doc_hash: docHash,
      chunk_hash: chunkHash,
      index_version: INDEX_VERSION,
    });
  });

  return { payloads, docHash };
}

async function embedBatch(texts: string[]) {
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((item) => item.embedding);
}

async function main() {
  await ensureCollection();
  const manifestMap = await loadManifest();
  const history = await loadHistory();
  const files = await listHtmlFiles();

  if (!files.length) {
    logInfo("kb.ingest.noop", { reason: "no-files" });
    return;
  }

  const targets = files.map((absPath) => {
    const entry =
      manifestMap[absPath] ??
      ({
        url: `${FALLBACK_BASE}/${path.basename(absPath)}`,
        file: path.relative(ROOT, absPath),
        fetchedAt: new Date().toISOString(),
        status: 200,
        title: path.basename(absPath),
      } satisfies ManifestEntry);
    return { entry, filePath: absPath };
  });

  const payloads: { payload: ChunkPayload; text: string; id: string }[] = [];
  let docCounter = 0;

  for (const target of targets) {
    const filePath = target.filePath;
    const html = await readFile(target.filePath, "utf8");
    const { payloads: docPayloads, docHash } = buildPayloads(
      html,
      target.entry,
    );
    if (!args.has("--all") && history[filePath] === docHash) {
      continue;
    }

    docPayloads.forEach((payload) =>
      payloads.push({
        payload,
        text: payload.text,
        id: hashToUuid(payload.chunk_hash),
      }),
    );
    history[filePath] = docHash;
    docCounter += 1;
  }

  if (!payloads.length) {
    logInfo("kb.ingest.noop", { reason: "no-changes" });
    return;
  }

  if (args.has("--dry-run")) {
    logInfo("kb.ingest.dry-run", {
      points: payloads.length,
      docs: docCounter,
    });
    return;
  }

  const batches = Math.ceil(payloads.length / BATCH_SIZE);
  const startedAt = performance.now();

  for (let i = 0; i < batches; i++) {
    const start = i * BATCH_SIZE;
    const slice = payloads.slice(start, start + BATCH_SIZE);
    const embeddings = await embedBatch(slice.map((item) => item.text));
    try {
      await qdrant.upsert(INDEX_NAME, {
        wait: true,
        points: slice.map((item, idx) => ({
        id: item.id,
          vector: embeddings[idx],
          payload: item.payload,
        })),
      });
    } catch (error) {
      logError("kb.ingest.upsert_failed", {
        batch: i + 1,
        message: error instanceof Error ? error.message : String(error),
        detail:
          typeof error === "object" && error !== null
            ? JSON.stringify(error, Object.getOwnPropertyNames(error))
            : undefined,
      });
      throw error;
    }
    logInfo("kb.ingest.batch", { batch: i + 1, total: batches, size: slice.length });
  }

  await saveHistory(history);

  const duration = Math.round(performance.now() - startedAt);
  logInfo("kb.ingest.completed", {
    points: payloads.length,
    docs: docCounter,
    duration_ms: duration,
  });
}

main().catch((err) => {
  logError("kb.ingest.failed", {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
