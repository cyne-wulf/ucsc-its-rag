# UCSC ITS RAG 

Retrieval-augmented chatbot for UCSC Information Technology Services. This repo keeps everything self-hostable on a single machine: Next.js UI + API, Qdrant vector store, ingestion scripts, and Docker Compose for demos.

## Repo layout

| path | purpose |
| --- | --- |
| `apps/web` | Next.js app (UI + `/api/answer`) |
| `scripts` | Node/TS utilities: `download-kb` and `ingest` |
| `data/kb` | Knowledge-base artifacts (`raw/`, `url-list.txt`, manifests, ingest history) |
| `infra` | Docker Compose, production Dockerfile, Fly.io notes |
| `apps/web/vector-store` | Bundled local vector index for Vercel/serverless |

## Prerequisites

- Node 20+ (works great on the M2 Air with OrbStack)
- `pnpm` (Corepack works: `corepack pnpm install`)
- Docker/OrbStack when running Qdrant locally or Compose
- OpenAI + Google Gemini API keys

## Environment variables

Copy `.env.example` → `.env.local` (for `pnpm dev`) and `.env.production.example` → `.env.production` (for Docker). Key vars:

| name | description |
| --- | --- |
| `OPENAI_API_KEY` | Embeddings (`text-embedding-3-small` by default) |
| `GEMINI_API_KEY` | Generation (`models/gemini-2.5-flash`) |
| `GEMINI_MODEL` | Defaults to `models/gemini-2.5-flash` (stable Gemini Flash) |
| `QDRANT_URL`, `QDRANT_API_KEY` | Vector DB endpoint (local `http://localhost:6333`) |
| `INDEX_NAME`, `INDEX_VERSION` | Qdrant collection metadata |
| `RETRIEVAL_TOP_K`, `RETRIEVAL_THRESHOLD` | Search knobs |
| `SYSTEM_PHONE_FALLBACK`, `ITS_TICKET_URL` | Structured fallback copy |

## Development workflow

1. **Install deps**
   ```bash
   pnpm install   # (or corepack pnpm install)
   ```
2. **Download KB HTML** (expects `data/kb/url-list.txt`; copy the `*.example` file and fill it with the KB URLs you want)
   ```bash
   pnpm download-kb         # saves html under data/kb/raw, manifest -> data/kb/manifest.json
   ```
3. **Start Qdrant locally**
   ```bash
   docker compose -f infra/docker-compose.yml up -d qdrant
   ```
4. **Ingest chunks → Qdrant** (skips unchanged docs thanks to `ingest-history.json`)
   ```bash
   pnpm ingest              # uses scripts/ingest.ts
   ```
5. **Run the web app**
   ```bash
   pnpm dev                 # Next.js + API routes w/ live reload
   ```

### Useful script flags

| command | description |
| --- | --- |
| `pnpm download-kb -- --force` | Re-fetch every URL even if cached |
| `pnpm ingest -- --all` | Re-embed everything (ignores history) |
| `pnpm ingest -- --dry-run` | Show what would change without uploading |

### Testing & linting

```bash
pnpm --filter web lint
pnpm --filter web test     # vitest (see apps/web/src/lib/__tests__)
```

## Docker / deployment

`infra/docker-compose.yml` runs both services on one box (laptop, Fly.io, Railway, DO droplet, etc.):

```bash
docker compose -f infra/docker-compose.yml up --build
```

The compose file:
- Spins up Qdrant with a named volume (`qdrant_data`)
- Builds the Next.js app via `infra/Dockerfile.web`
- Reads env vars from `../.env.production`

Fly.io note: deploy a single app with two processes (web + qdrant) and attach a volume for `/qdrant/storage`. Railway/Render follow the same compose file. Any plain VM can simply `git pull && docker compose up -d`.

## Managed hosting (Vercel)

Prefer a managed platform? Vercel can host the Next.js UI + API while Qdrant runs on its own service. The quick version:

1. Spin up Qdrant Cloud (or any hosted Qdrant), then run `pnpm download-kb` / `pnpm ingest` locally while pointing to that endpoint.
2. `pnpm dlx vercel link --cwd apps/web` to create a project rooted at the Next.js app.
3. Add the env vars from `.env.example` in the Vercel dashboard (Preview + Production).
4. Deploy with `pnpm dlx vercel --cwd apps/web --prod` or via the GitHub integration (build command `pnpm --filter web build`, install command `pnpm install --frozen-lockfile`, root directory `apps/web`).

See `docs/VERCEL.md` for the detailed runbook (including env var reference and validation steps).

### Local vector index (no Qdrant)

For serverless platforms (Vercel) you can skip Qdrant entirely by bundling the embeddings:

1. Make sure `data/kb/raw` contains the HTML corpus and run the usual ingestion pipeline to keep it fresh.
2. Build the local index: `pnpm --filter scripts run build-index`. This creates/updates `data/kb/vector-store.json` and syncs a copy under `apps/web/vector-store/vector-store.json` for the Next.js bundle.
3. Set `VECTOR_BACKEND=local` in the environment (Preview + Production) and redeploy. The API routes will now read the embedded vectors directly from disk and perform cosine similarity in-process.

> Important: the `build-index` script talks to OpenAI to embed each chunk. Re-run it after refreshing the KB content so the bundled vectors stay in sync with the latest articles.

## Evaluation + logging

- Retrieval metrics: log records (query, scores, latency, cache hits) from `/api/answer` for offline review (`stdout` JSON).
- Add gold queries to `eval/` (create `eval/queries.yaml`) to measure miss@k and faithfulness before experimenting with rerankers or hybrid search.
- Anti-tamper: prompts enforce refusal when sources lack evidence and include the phone fallback CTA for manual escalation.

## Next steps

1. Populate `data/kb/url-list.txt` with the official ITS KB sitemap & ingest the full corpus.
2. Add a lightweight reranker (bge) if retrieval miss rate >10%.
3. Introduce Redis for cross-instance caching if you deploy beyond a single Node worker.
4. Build the Expo client pointed at the same `/api/answer` endpoint.
5. Harden analytics + auth before exposing to campus traffic.

_See `apps/web/README.md` for UI/API specifics and `infra/README.md` for deployment walkthroughs._
