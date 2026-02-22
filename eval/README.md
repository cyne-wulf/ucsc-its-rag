# Evaluation harness

Create `eval/queries.yaml` with a list of gold questions + expected KB URLs to track retrieval hit rate and answer quality.

```yaml
- query: "Reset CruzID Blue password"
  expected:
    - https://its.ucsc.edu/kb/article?id=kb001131
- query: "Install Duo on a new phone"
  expected:
    - https://its.ucsc.edu/kb/article?id=kb001077#new-device
```

Then run (placeholder, script todo):

```bash
pnpm --filter web exec tsx scripts/eval.ts
```

Log files from `/api/answer` (stdout JSON lines) capture `{ query, normalizedQuery, ids, scores, latency_ms, cache_hit }` per call so you can compute miss@k and hallucination rates offline.
