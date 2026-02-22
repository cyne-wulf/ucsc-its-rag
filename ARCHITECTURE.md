# UCSC ITS RAG Architecture

This document provides an exhaustive technical deep-dive into the UCSC Information Technology Services (ITS) Retrieval-Augmented Generation (RAG) system. It covers the core components, data ingestion pipeline, retrieval mechanics, and the nuances of local vs. remote (Vercel) hosting.

---

## 1. High-Level Overview

The system is a specialized RAG application designed to answer questions based on the UCSC ITS knowledge base. It uses a Next.js frontend/backend, OpenAI for embeddings, Google Gemini for generation, and a flexible vector store backend (Qdrant or a local JSON-based index).

### Core Philosophy
- **Performance**: Minimize latency by caching both retrieval results and final answers.
- **Portability**: Support for a "zero-infra" deployment on Vercel using a bundled JSON vector store.
- **Accuracy**: Precise HTML extraction and chunking to ensure the LLM receives relevant context.

---

## 2. Component Breakdown

### 2.1 Web Application (`apps/web`)
A Next.js 15 application utilizing the App Router and fully typed TypeScript components.

- **Frontend (`src/app/page.tsx`)**: A React-based chat interface built with hooks, CSS Modules (`chat-app.module.css`), and TanStack Query to orchestrate client-side mutations. Messages now support full Markdown rendering (via `react-markdown`/`remark-gfm`) so answers preserve headings, lists, inline code, etc.
- **API Routes (`src/app/api/`)**:
    - `/answer`: The primary POST endpoint that accepts a `question` and returns a structured JSON response (answer, sources, metadata). It enforces schema validation with `zod`.
    - `/search`: Diagnostic endpoint that exposes raw retrieval hits without running generation (useful for evaluating recall).
    - `/preview`: Serves sanitized HTML snapshots of KB articles, rewrites links, and injects CSS so citations can be rendered inside secure iframes.
    - `/health`: Lightweight liveness probe used by Compose/Fly deployments.

### 2.2 RAG Engine (`apps/web/src/lib/`)
The "brain" of the application, responsible for the RAG lifecycle.

- **`rag.ts`**: Orchestrates `Question -> Embed -> Retrieve -> Prompt -> Generate`. It maintains two TTL-based `LruCache` instances so both retrieval results and final answers can be reused across requests (critical on Vercel where cold-starts are expensive).
- **`embedder.ts`**: Interfaces with OpenAI's `text-embedding-3-small` (1536 dimensions) to convert text into vectors. It also normalizes queries (lowercase, trim) so semantic duplicates hash to the same key.
- **`generator.ts`**: Interfaces with Google's Generative AI SDK. It defaults to the **stable** `models/gemini-2.5-flash` and includes robust error classification: invalid model, auth failure, rate limits, upstream outages, etc. When a configured model is missing it automatically falls back to the bundled 2.5 Flash.
- **`prompt.ts`**: Constructs the system prompt, injecting the retrieved chunks as context and applying ITS-specific guardrails (refusal handling, phone numbers, ticket URLs).
- **`vector-backend.ts`**: A runtime abstraction that routes queries either to `local-vector-store.ts` or `qdrant.ts` based on `VECTOR_BACKEND`. When a backend fails, it throws structured `RagError`s that bubble up to the API response so the UI can show descriptive failures.
- **`logger.ts`** and **`errors.ts`**: Provide consistent JSON logging and typed error objects so Vercel logs (or Docker stdout) remain machine-readable.

### 2.3 Vector Backends
The system supports two distinct vector storage strategies:

1.  **Qdrant (`qdrant.ts`)**: Uses the `@qdrant/js-client-rest` client to communicate with a Qdrant cluster. This is the preferred method for large datasets or dynamic updates.
2.  **Local JSON (`local-vector-store.ts`)**: Loads the bundled `apps/web/vector-store/vector-store.json` into memory at import time. It performs in-process cosine similarity calculations using `Float32Array`, pre-computed norms, and manual dot products. This path is optimized for Vercel’s serverless environment (zero network hop, no managed DB).

### 2.4 Ingestion Pipeline (`scripts/`)
A set of TypeScript scripts for preparing the knowledge base.

- **`download-kb.ts`**: Crawls/fetches the raw HTML from the ITS website based on `url-list.txt`.
- **`ingest.ts`**: The primary pipeline for Qdrant. It extracts text from HTML, chunks it, embeds it via OpenAI, and upserts to a remote Qdrant collection.
- **`build-local-index.ts`**: Generates the static `vector-store.json` used by the "Local" backend. It embeds every chunk and copies the output into both `data/kb/vector-store.json` (ground truth) and `apps/web/vector-store/vector-store.json` (bundled artifact).
- **`lib/chunker.ts`**: Implements a recursive/segment-based chunking strategy. It respects HTML structure (headers, paragraphs) to ensure chunks are semantically coherent.

---

## 3. Data Flow Detail

### 3.1 The Ingestion Flow (Pre-deployment)
1.  **Source**: Raw HTML files in `data/kb/raw/`.
2.  **Extraction**: `html.ts` strips scripts/styles and extracts title, breadcrumbs, and content segments.
3.  **Chunking**: `chunker.ts` groups segments into chunks of roughly 1000-2000 characters, ensuring headers are preserved.
4.  **Hashing**: Every chunk gets a deterministic `chunk_hash` based on the document hash and chunk index.
5.  **Embedding**: Chunks are sent to OpenAI `text-embedding-3-small` in batches.
6.  **Storage**: 
    -   *Remote*: Upserted to Qdrant with the vector and metadata payload.
    -   *Local*: Written to `apps/web/vector-store/vector-store.json`.

### 3.2 The Query Flow (Runtime)
1.  **Input**: User types "How do I reset my password?".
2.  **Normalization**: Text is trimmed and lowercased.
3.  **Embedding**: Query is converted to a 1536-dim vector.
4.  **Retrieval**: 
    -   The system looks for a cached result for this query vector.
    -   If not cached, it queries the backend (Qdrant or Local) for the top `RETRIEVAL_TOP_K` (default 20) hits.
    -   Hits are filtered by `RETRIEVAL_THRESHOLD` (default 0.25).
5.  **Prompting**: The top 5 hits are formatted into a context block.
6.  **Generation**: Gemini generates an answer based on the context.
7.  **Response**: The answer, sources (with snippets and URLs), and metadata (cache status, timing) are returned to the UI.

---

## 4. Hosting: Local vs. Vercel

The architecture is designed to be "identical in logic, different in infrastructure."

| Feature | Local Hosting (Docker/Dev) | Remote Hosting (Vercel) |
| :--- | :--- | :--- |
| **Server** | Node.js (Next.js dev server) | Vercel Serverless Functions |
| **Vector Store** | Qdrant (Docker container at `:6333`) | **Local JSON** (Bundled in deployment) |
| **Environment** | `.env.local` / `.env.production` | Vercel Dashboard Env Vars (`vercel env pull`) |
| **Latency** | Low (localhost) | Low (in-memory search inside the Lambda) |
| **Data Persistence** | Qdrant volumes on disk | Static JSON file in build output |
| **Scaling** | Manual (Docker) | Automatic (Vercel serverless + edge cache) |

### 4.1 The "Local" Backend on Vercel
Vercel functions have strict execution limits and cannot easily maintain a persistent connection to a "sidecar" database without overhead. By setting `VECTOR_BACKEND=local`, the application:
1.  Imports `vector-store.json` at build time (bundled via Webpack/Turbopack).
2.  During a request, the entire index is already in the function's memory and shared across warm invocations.
3.  Cosine similarity is calculated in ~10-50ms for thousands of chunks.
4.  **Result**: Zero infrastructure cost (no Qdrant Cloud bill) and extremely fast retrieval. The trade-off is bundle size (~5–15 MB) and lack of real-time updates.

### 4.2 Remote Qdrant Option
If the KB grows beyond ~10,000 chunks or needs frequent updates, the JSON file might exceed Vercel's bundle size limits. In that case:
1.  Set `VECTOR_BACKEND=qdrant`, `QDRANT_URL=https://YOUR-CLUSTER`, and (optionally) `QDRANT_API_KEY`.
2.  The API routes connect to Qdrant per request. Thanks to caching, repeated queries still avoid repeated searches.
3.  The ingestion pipeline (`pnpm ingest`) pushes updates directly to the hosted collection.

### 4.3 Environment Configuration & Secrets
- `apps/web/src/lib/env.ts` normalizes all env vars (trimming whitespace, defaulting `VECTOR_BACKEND` to `local` on Vercel, and enforcing non-empty API keys).
- `vercel env pull` keeps `.env.vercel.production` in sync, ensuring deployments always include the bundled vectors and Gemini/OpenAI credentials.

### 4.4 Error Handling & Observability
- Every major subsystem throws `RagError` instances with `code`, `status`, and `details`.
- API routes log structured events (`api.answer.success`, `gemini.invalid_model`, etc.) to stdout. On Vercel these entries appear in the deployment logs for troubleshooting.
- The chat UI surfaces the server-supplied error details so operators can see issues like "Gemini rejected the configured model" directly from the browser.

---

## 5. Technical Specifications

- **Embedding Model**: `text-embedding-3-small` (OpenAI)
- **Generative Model**: `gemini-2.5-flash` (Google)
- **Vector Dimension**: 1536
- **Distance Metric**: Cosine Similarity
- **Default Top-K**: 20 (Retrieval), 5 (Context)
- **Caching**: 
    -   `retrievalCache`: Map<Hash(Query), RetrievedChunk[]>
    -   `answerCache`: Map<Hash(Query + ChunkIDs), AnswerResult>
    -   TTL: 600 seconds.
- **HTML Extraction**: Custom logic to preserve `title`, `breadcrumbs`, and `updated` timestamps from UCSC ITS article templates.

---

## 6. Directory Mapping

- `/apps/web/src/lib`: Core logic (The "RAG Library").
- `/apps/web/src/app`: Routing and UI.
- `/apps/web/vector-store`: Bundled JSON index used when `VECTOR_BACKEND=local`.
- `/scripts`: Data processing tools (download, ingest, build index, debug helpers).
- `/data/kb/raw`: Input HTML for the ingestion pipeline.
- `/data/kb/vector-store.json`: Canonical serialized embedding store before copying into the app bundle.
- `/infra`: Docker Compose, Caddy config, and production Dockerfiles for self-hosted setups.
- `/docs`: Detailed guides for Vercel, Qdrant, and operational runbooks.
