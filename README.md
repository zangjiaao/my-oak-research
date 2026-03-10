# OAK Research

Oak Research is a monorepo for research collection and knowledge processing:

- `apps/web`: Next.js web app and API routes
- `apps/worker`: background worker for queue jobs
- `apps/gather`: Python gather service (social media data collection)
- `packages/agents`: shared AI/agent utilities
- `docker/local`: local PostgreSQL + Redis + MinIO infra

## Tech Stack

- Node.js + npm workspaces + Turborepo
- Next.js 15 + React 19 + TypeScript
- Prisma + PostgreSQL (pgvector)
- Redis + BullMQ
- MinIO (S3 compatible storage)
- Python (gather service, via `uv`)

## Prerequisites

- Node.js `>=18`
- npm `>=11`
- Docker Desktop
- Python `3.13` and `uv` (for `apps/gather`)

## Local Setup

1) Install dependencies (repo root):

```bash
npm install
```

2) Start local infra:

```bash
cd docker/local
docker compose -f docker-compose.dev.yml up -d
```

3) Create env files:

- `apps/web/.env` from `apps/web/.env.example`
- `apps/worker/.env` from `apps/worker/.env.example`
- Optional: `apps/gather/.env` from `apps/gather/.env.example`

For local Docker defaults, use:

```env
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/oak_research
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/oak_research
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
MINIO_ENDPOINT=http://localhost:9000
MINIO_REGION=us-east-1
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=oak-research
GATHER_SERVICE_URL=http://localhost:8000
```

4) Run DB migration/seed (from `apps/web`):

```bash
cd apps/web
npx prisma migrate deploy
npx prisma db seed
```

## Run Services

From repo root:

```bash
npm --workspace web run dev
npm --workspace worker run dev
```

Gather service:

```bash
cd apps/gather
uv sync
playwright install chromium
uv run main.py
```

Default endpoints:

- Web: `http://localhost:3000`
- Gather: `http://localhost:8000`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

## Useful Commands

```bash
# Web
npm --workspace web run lint
npm --workspace web run check-types
npm --workspace web run test

# Worker
npm --workspace worker run check-types
```

## Logging

- Use centralized logger module: `apps/web/lib/logger.ts`
- Do not write runtime logs to tracked files like `apps/web/error.log`
- Configure by env:
  - `LOG_LEVEL` (`debug|info|warn|error`)
  - `LOG_APP_NAME` (service name)

## Troubleshooting

- If Prisma reports TLS/SSL issues against local PostgreSQL, confirm the URL uses `localhost`/`127.0.0.1` and local docker credentials.
- If web startup fails due missing env values, re-check `apps/web/.env` and `apps/worker/.env`.
