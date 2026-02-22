# Deploying to Vercel

Vercel can host the Next.js UI + API. You still need a managed Qdrant cluster plus API keys for OpenAI and Gemini. This doc assumes you already generated embeddings into your Qdrant collection by running `pnpm download-kb` and `pnpm ingest` locally.

## 1. Prepare managed services

1. **Qdrant Cloud (or any hosted Qdrant)**  
   - Create a cluster with at least 1 vCPU / 2 GiB RAM.  
   - Create an API key that has read/write access to the collection (used for ingest + read).  
   - Record the HTTPS endpoint and API key.
2. **OpenAI & Gemini keys**  
   - `OPENAI_API_KEY` should have access to `text-embedding-3-small`.  
   - `GEMINI_API_KEY` must have access to `models/gemini-2.5-flash` (our default). Keep `models/gemini-1.5-flash` enabled only if you plan to override `GEMINI_MODEL` for compatibility testing.

## 2. Ship knowledge base content

1. Copy `data/kb/url-list.example.txt` → `data/kb/url-list.txt` and fill it with the ITS KB URLs you want.
2. Run the ingestion pipeline locally while pointing at the hosted Qdrant instance:

```bash
export QDRANT_URL="https://YOUR-CLOUD-ENDPOINT"
export QDRANT_API_KEY="qdrant_xxx"
pnpm download-kb
pnpm ingest
```

3. Verify the collection now contains points. A quick check with the script:

```bash
pnpm --filter scripts ts-node scripts/debug-query.ts "Reset CruzID"
```

## 3. Configure Vercel locally

1. Install/upgrade the CLI: `pnpm dlx vercel@latest`.
2. Login: `pnpm dlx vercel login` (opens a browser once).
3. Link this repo to a new project while scoping to the Next.js app:

```bash
pnpm dlx vercel link --cwd apps/web
```

   - Choose “Create a new project”.
   - Use `ucsc-its-rag` (or similar) as the project name.

## 4. Set environment variables

Run `pnpm dlx vercel env pull --cwd apps/web .env.local` once to get a local copy. Then add the variables below in the Vercel dashboard (Project Settings → Environment Variables) for **Preview** and **Production**:

| Key | Notes |
| --- | --- |
| `OPENAI_API_KEY` | Required |
| `GEMINI_API_KEY` | Required |
| `QDRANT_URL` | Use the hosted endpoint |
| `QDRANT_API_KEY` | Required if the cluster enforces auth |
| `INDEX_NAME` | Defaults to `its-kb` |
| `INDEX_VERSION` | Bump when re-ingesting |
| `RETRIEVAL_TOP_K` | Optional tune |
| `RETRIEVAL_THRESHOLD` | Optional tune |
| `SYSTEM_PHONE_FALLBACK` | Shown in fallback messages |
| `ITS_TICKET_URL` | Link for manual escalation |
| `ACRONYM_MAP` | JSON like `{"ITS":"Information Technology Services"}` |
| `KB_ROOT_DIR` | Optional absolute path to snapshot HTML if you sync them to persistent storage |
| `KB_HISTORY_PATH` | Optional explicit path to `ingest-history.json` |
| `VECTOR_BACKEND` | `local` when you bundle `apps/web/vector-store/vector-store.json` |

Vercel automatically exposes them to both the serverless API routes and client bundle (because this app only consumes them server-side).

## 5. Deploy

```bash
pnpm dlx vercel --cwd apps/web --prod
```

The CLI will:

1. Install dependencies with `pnpm`.
2. Build the Next.js app (using the `apps/web/next.config.ts` file).
3. Upload the standalone output + serverless functions.

After the first deploy, connect the GitHub repo to the same project so that pushes to `main` trigger automatic deployments:

- Build command: `pnpm --filter web build`  
- Install command: `pnpm install --frozen-lockfile`  
- Output directory: leave blank (Next.js manages it)  
- Root directory: `apps/web`

## 6. Post-deploy checklist

- Hit `/api/answer` with a known-good question and confirm responses within ~3s.  
- Use the “Preview pane” in the UI to ensure snapshots render; if not, set `KB_ROOT_DIR` to a Cloud Storage bucket path or skip previews.  
- Monitor the Vercel function logs for `api.answer.error` messages.  
- Add an uptime check (Better Stack, Pingdom, etc.) on the production endpoint.

### Bundled vector store option

Qdrant is great while iterating locally, but Vercel cannot reach `localhost:6333`. To make the deployment self-contained:

1. Run `pnpm --filter scripts run build-index`. The script re-embeds every chunk via OpenAI and writes two files:
   - `data/kb/vector-store.json` (canonical source)
   - `apps/web/vector-store/vector-store.json` (consumed by the Next.js API routes)
2. Set `VECTOR_BACKEND=local` for both Preview and Production environments (`vercel env add VECTOR_BACKEND production` etc.).
3. Redeploy with `pnpm dlx vercel --cwd apps/web --prod`. During runtime the API simply loads the JSON payload, computes cosine similarity in-process, and returns answers without ever hitting Qdrant.

Whenever you refresh the KB (new raw HTML or updated articles), rerun the `build-index` script so the bundled vectors stay aligned with the content.

> Need higher throughput? Slide the Vercel plan to Pro to bump the serverless timeout to 60s and enable autoscaling regions closer to California.
