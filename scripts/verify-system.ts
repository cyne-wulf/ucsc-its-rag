#!/usr/bin/env ts-node
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { GoogleGenerativeAI } from "@google/generative-ai";

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env.local") });
dotenv.config({ path: path.join(ROOT, ".env") });

const REQUIRED_VARS = [
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "QDRANT_URL",
  "INDEX_NAME",
  "EMBEDDING_MODEL",
  "GEMINI_MODEL",
];

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const {
  OPENAI_API_KEY,
  GEMINI_API_KEY,
  QDRANT_URL,
  INDEX_NAME,
  EMBEDDING_MODEL,
  GEMINI_MODEL: RAW_GEMINI_MODEL,
} = process.env;

const GEMINI_MODEL = RAW_GEMINI_MODEL?.trim();

const openai = new OpenAI({ apiKey: OPENAI_API_KEY! });
const qdrant = new QdrantClient({
  url: QDRANT_URL!,
  timeout: 60000,
  checkCompatibility: false,
});
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!);
const resolvedGeminiModel = GEMINI_MODEL!.startsWith("models/")
  ? GEMINI_MODEL!
  : `models/${GEMINI_MODEL!}`;
const fallbackGeminiModel = "models/gemini-2.5-flash";

async function runGemini(prompt: string) {
  const candidates = [resolvedGeminiModel, fallbackGeminiModel].filter(
    Boolean,
  ) as string[];
  let lastError: unknown;
  for (const modelName of candidates) {
    try {
      const llm = genAI.getGenerativeModel({ model: modelName });
      const result = await llm.generateContent(prompt);
      const text = result.response?.text()?.trim();
      if (!text) {
        throw new Error(`Gemini ${modelName} returned empty response`);
      }
      return text;
    } catch (error) {
      lastError = error;
      const status = (error as any)?.status;
      if (status === 404) {
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("No Gemini models succeeded");
}

async function step(label: string, fn: () => Promise<void>) {
  process.stdout.write(`→ ${label}... `);
  await fn();
  process.stdout.write("OK\n");
}

async function checkQdrantHealth() {
  const res = await fetch(`${QDRANT_URL}/collections`);
  if (!res.ok) {
    throw new Error(`Qdrant responded with ${res.status}`);
  }
  await res.json();
}

async function ensureCorpusHasContent() {
  const res = await fetch(`${QDRANT_URL}/collections/${INDEX_NAME}/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 5 }),
  });
  if (!res.ok) {
    throw new Error(`Failed to scroll collection: ${res.status}`);
  }
  const data = (await res.json()) as any;
  const points = data?.result?.points ?? [];
  if (!points.length) {
    throw new Error("Collection contains no points");
  }

  const invalid = points.filter((point: any) => {
    const text = point?.payload?.text as string | undefined;
    if (!text) return true;
    const normalized = text.trim();
    if (normalized.length < 80) return true;
    return /loading/i.test(normalized);
  });

  if (invalid.length) {
    throw new Error(
      `Found ${invalid.length} placeholder snippets (e.g., "Loading...") in ${INDEX_NAME}`,
    );
  }
}

async function checkGeminiHandshake() {
  await runGemini("Hello World");
}

async function embed(text: string) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL!,
    input: text,
  });
  return response.data[0].embedding;
}

async function pipelineTest() {
  const collection = `${INDEX_NAME}-verify-${Date.now()}`;
  const docId = crypto.randomUUID();
  const docText = "The magic code is 12345.";
  const question = "What is the magic code?";

  await qdrant.deleteCollection(collection).catch(() => {});
  await qdrant.createCollection(collection, {
    vectors: { size: 1536, distance: "Cosine" },
  });

  try {
    const docVector = await embed(docText);
    await qdrant.upsert(collection, {
      wait: true,
      points: [
        {
          id: docId,
          vector: docVector,
          payload: {
            title: "Test Doc",
            text: docText,
          },
        },
      ],
    });

    const queryVector = await embed(question);
    const search = await qdrant.search(collection, {
      vector: queryVector,
      limit: 1,
      with_payload: true,
      score_threshold: 0,
    });

    if (!search.length) {
      throw new Error("Search returned 0 results");
    }
    if ((search[0].score ?? 0) < 0.25) {
      throw new Error(
        `Search score below threshold: ${(search[0].score ?? 0).toFixed(3)}`,
      );
    }

    const context = search.map((s) => (s.payload as any)?.text ?? "").join("\n");
    const completion = await runGemini(
      `Context:\n${context}\n\nQuestion: ${question}\nAnswer with only the code.`,
    );
    const answer = completion.toLowerCase();
    if (!answer.includes("12345")) {
      throw new Error("Gemini response missing magic code");
    }
  } finally {
    await qdrant.deleteCollection(collection).catch(() => {});
  }
}

async function apiEndpointTest() {
  const { answerQuestion } = await import("../apps/web/src/lib/rag");
  const result = await answerQuestion("How do I reset my password?");
  if (typeof result.answer !== "string" || !result.answer.trim()) {
    throw new Error("RAG answer missing text");
  }
  if (!Array.isArray(result.sources) || result.sources.length === 0) {
    throw new Error("RAG answer missing sources");
  }
  if ((result.metadata?.retrievalCount ?? 0) <= 0) {
    throw new Error("Snippets searched was zero");
  }
}

async function main() {
  try {
    await step("Qdrant health check", checkQdrantHealth);
    await step("Corpus sanity check", ensureCorpusHasContent);
    await step("Gemini handshake", checkGeminiHandshake);
    await step("Pipeline integration test", pipelineTest);
    await step("API endpoint simulation", apiEndpointTest);
    console.log("✅ Verification PASS");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Verification FAIL:", error);
    process.exit(1);
  }
}

main();
