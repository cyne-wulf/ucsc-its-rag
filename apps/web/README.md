# Web App (Next.js)

Shares UI + API in one Next.js App Router project.

## Features

- Two-pane layout: conversational UI on top, live KB preview iframe below
- `/api/answer` API route orchestrates OpenAI embeddings, Qdrant retrieval, Gemini generation, and caching
- Structured fallback messaging when the KB lacks coverage
- React Query for in-flight state, numeric citation chips for source hopping
- In-process LRU caches for retrieval + answer (swap to Redis later without touching callers)

## Commands

```bash
pnpm dev          # run locally with turbopack
pnpm build        # production bundle
pnpm start        # run the standalone server output
pnpm lint         # next lint
pnpm test         # vitest (see src/lib/__tests__)
```

## File map

| path | purpose |
| --- | --- |
| `src/app/page.tsx` | Shell that renders `<ChatApp />` |
| `src/components/chat-app.tsx` | Client component with UI logic |
| `src/app/api/answer/route.ts` | Serverless handler for questions |
| `src/lib/*` | Shared server utilities (env, cache, rag orchestrator, etc.) |
| `public/slug.svg` | Mascot asset |

## API contract

`POST /api/answer`

```json
{
  "question": "How do I reset my CruzID Blue password?"
}
```

Response:

```json
{
  "answer": "…with [1] citations…",
  "sources": [{ "id": "chunk", "title": "Reset CruzID", "url": "https://its.ucsc.edu/..." }],
  "metadata": {
    "cached": false,
    "retrievalCount": 18,
    "latencyMs": 155
  },
  "fallbackMessage": "If that doesn't help…"
}
```

## UI customization

- Update example prompts in `chat-app.tsx`
- Adjust look & feel in `src/components/chat-app.module.css` / `globals.css`
- Slug mascot lives at `public/slug.svg`
- If the ITS KB ever sets `X-Frame-Options`, the iframe will fail gracefully and the “Open in new tab” link remains as fallback.
