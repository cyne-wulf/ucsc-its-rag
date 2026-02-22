#!/usr/bin/env ts-node
import path from "node:path";
import dotenv from "dotenv";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env.local") });
dotenv.config({ path: path.join(ROOT, ".env") });

const query = process.argv.slice(2).join(" ") || "Get eduroam Wi-Fi on macOS";

async function main() {
  const client = new QdrantClient({
    url: process.env.QDRANT_URL || "http://localhost:6333",
    checkCompatibility: false,
  });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const vector = (
    await openai.embeddings.create({
      model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
      input: query,
    })
  ).data[0].embedding;
  const results = await client.search(process.env.INDEX_NAME || "its-kb", {
    vector,
    limit: 5,
    with_payload: true,
    score_threshold: 0.0,
  });
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
