# Infra playbook

## Local Docker Compose

```bash
docker compose -f infra/docker-compose.yml up --build
```

This launches:

| service | description |
| --- | --- |
| `qdrant` | Vector DB with persistent volume `qdrant_data` |
| `web` | Next.js standalone server |

- Qdrant HTTP: `http://localhost:6333`
- Web UI/API: `http://localhost:3000`

Provide `../.env.production` before running (copy from `.env.production.example` and fill API keys).

## Fly.io (single app, single bill)

1. `fly launch --no-deploy` inside repo root.
2. Define two processes in `fly.toml`:
   ```toml
   [processes]
   web = "node server.js"
   qdrant = "/qdrant/entrypoint.sh"
   ```
3. Attach a volume for Qdrant:
   ```bash
   fly volumes create qdrant_data --size 10
   ```
4. Use `fly secrets set $(cat .env.production | xargs)` for API keys.
5. Deploy with `fly deploy --dockerfile infra/Dockerfile.web`.

## Render / Railway / plain VM

- Render/Railway support multi-service Compose → point their deployment to `infra/docker-compose.yml`.
- Plain VM: install Docker, `git pull`, then `docker compose -f infra/docker-compose.yml up -d`.

## Caddy (optional TLS)

`infra/Caddyfile` proxies TLS → `web:3000`. Add it as a third service in Compose when you need certificates (Caddy handles Let’s Encrypt automatically).
