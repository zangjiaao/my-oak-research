# Local Infra (Docker)

This folder provides local development infrastructure for Oak Research.

## Services

- PostgreSQL with pgvector (`pgvector/pgvector:pg16`)
- Redis (`redis:7-alpine`)
- MinIO (`minio/minio:latest`)

## Start

```bash
cd docker/local
docker compose -f docker-compose.dev.yml up -d
```

or

```bash
cd docker/local
./run.sh
```

## Stop

```bash
cd docker/local
docker compose -f docker-compose.dev.yml down
```

## Recommended app env values

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
```
