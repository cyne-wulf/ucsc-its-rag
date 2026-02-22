#!/usr/bin/env ts-node
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import OpenAI from "openai";
import { extractFromHtml } from "./lib/html";
import { chunkSegments } from "./lib/chunker";
import { sha256, hashId } from "./lib/hash";
import type { ChunkPayload, ManifestEntry } from "./lib/types";

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env.local") });
dotenv.config({ path: path.join(ROOT, ".env") });
dotenv.config({ path: path.join(ROOT, ".env.production") });

const KB_ROOT = process.env.KB_ROOT_DIR || path.join(ROOT, "data", "kb");
const RAW_DIR = process.env.KB_RAW_DIR || path.join(KB_ROOT, "raw");
const MANIFEST_PATH =
  process.env.KB_MANIFEST || path.join(KB_ROOT, "manifest.json");
const OUTPUT_PATH =
  process.env.LOCAL_INDEX_PATH || path.join(KB_ROOT, "vector-store.json");
const APP_VECTOR_PATH = path.join(
  ROOT,
  "apps",
  "web",
  "vector-store",
  "vector-store.json",
);

const INDEX_NAME = process.env.INDEX_NAME || "its-kb";
const INDEX_VERSION = Number(process.env.INDEX_VERSION || "1");
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BATCH_SIZE = Number(process.env.INDEX_BATCH_SIZE || "64");

if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required to build the local index");
}

if (!existsSync(RAW_DIR)) {
  throw new Error(`RAW_DIR not found: ${RAW_DIR}`);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

type HistoryMap = Record<string, ManifestEntry>;

type PendingPayload = {
  payload: ChunkPayload;
  text: string;
};

async function loadManifest(): Promise<HistoryMap> {
  if (!existsSync(MANIFEST_PATH)) {
    return {};
  }
  const raw = await readFile(MANIFEST_PATH, "utf8");
  const entries = JSON.parse(raw) as ManifestEntry[];
  const map: HistoryMap = {};
  entries.forEach((entry) => {
    const absPath = path.join(ROOT, entry.file);
    map[absPath] = entry;
  });
  return map;
}

function buildPayloads(
  html: string,
  entry: ManifestEntry,
): { payloads: ChunkPayload[] } {
  const extracted = extractFromHtml(html);
  const docHash = sha256(html);
  const payloads: ChunkPayload[] = [];
  const chunks = chunkSegments(extracted.segments);
  chunks.forEach((chunk, index) => {
    const chunkHash = hashId([docHash, index, INDEX_VERSION]);
    payloads.push({
      title: extracted.title,
      url: entry.url,
      anchor: chunk.anchor,
      breadcrumbs: chunk.breadcrumbs,
      updated: extracted.updated || entry.updated,
      text: chunk.text,
      doc_hash: docHash,
      chunk_hash: chunkHash,
      index_version: INDEX_VERSION,
    });
  });
  return { payloads };
}

async function listHtmlFiles(): Promise<string[]> {
  const entries = await readdir(RAW_DIR);
  return entries
    .filter((file) => file.endsWith(".html"))
    .map((file) => path.join(RAW_DIR, file));
}

function vectorNorm(values: number[]) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

async function main() {
  const manifest = await loadManifest();
  const files = await listHtmlFiles();
  if (!files.length) {
    console.log("No HTML files found under", RAW_DIR);
    return;
  }

  const pending: PendingPayload[] = [];
  for (const filePath of files) {
    const entry =
      manifest[filePath] ??
      ({
        url: path.basename(filePath),
        file: path.relative(ROOT, filePath),
        title: path.basename(filePath),
        fetchedAt: new Date().toISOString(),
        status: 200,
      } satisfies ManifestEntry);

    const html = await readFile(filePath, "utf8");
    const { payloads } = buildPayloads(html, entry);
    payloads.forEach((payload) =>
      pending.push({
        payload,
        text: payload.text,
      }),
    );
  }

  if (!pending.length) {
    console.log("No payloads generated from HTML files.");
    return;
  }

  console.log(
    `Embedding ${pending.length} chunks across ${files.length} documents...`,
  );

  const vectorEntries: Array<{
    id: string;
    vector: number[];
    vectorNorm: number;
    payload: ChunkPayload;
  }> = [];

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const embeddings = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((item) => item.text),
    });
    embeddings.data.forEach((item, idx) => {
      const vector = item.embedding;
      const payload = batch[idx]?.payload;
      if (!payload) return;
      vectorEntries.push({
        id: payload.chunk_hash,
        vector,
        vectorNorm: vectorNorm(vector),
        payload,
      });
    });
    process.stdout.write(
      `Embedded ${Math.min(i + BATCH_SIZE, pending.length)} / ${
        pending.length
      }\r`,
    );
  }
  process.stdout.write("\n");

  const output = {
    version: INDEX_VERSION,
    embeddingModel: EMBEDDING_MODEL,
    dimension: vectorEntries[0]?.vector.length ?? 0,
    count: vectorEntries.length,
    generatedAt: new Date().toISOString(),
    indexName: INDEX_NAME,
    entries: vectorEntries,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output));
  await mkdir(path.dirname(APP_VECTOR_PATH), { recursive: true });
  await writeFile(APP_VECTOR_PATH, JSON.stringify(output));
  console.log(
    `Local index written to ${OUTPUT_PATH} and synced to ${APP_VECTOR_PATH} (${vectorEntries.length} entries)`,
  );
}

main().catch((error) => {
  console.error("Failed to build local index:", error);
  process.exit(1);
});
