# AGENTS.md

This file defines project-specific instructions for coding agents working in this repository.

## 1) Project Overview

Oak Research is a monorepo with three runtime services:

- `apps/web`: Next.js app (UI + API routes)
- `apps/worker`: background queue worker (BullMQ)
- `apps/gather`: Python gather service for social platforms

Shared package:

- `packages/agents`: AI and extraction utilities used by web/worker

Local infrastructure:

- `docker/local/docker-compose.dev.yml` starts PostgreSQL (pgvector), Redis, MinIO

## 2) Build, Run, and Test Commands

Run from repository root unless noted.

### Install

```bash
npm install
```

### Local infra

```bash
cd docker/local
docker compose -f docker-compose.dev.yml up -d
```

### Development

```bash
npm run dev:web
npm run dev:worker
```

Gather service:

```bash
npm run dev:gather
```

### Quality checks

```bash
npm --workspace web run lint
npm --workspace web run check-types
npm --workspace web run test
npm --workspace worker run check-types
```

## 3) Environment and Data Setup

- Use shared env directory via `OAK_ENV_DIR` (for example `D:\Coding\my-oak-research-env`).
- Canonical env examples live in `config/env`.
- Store app env files there:
  - `.env.common`
  - `.env.apps.web`
  - `.env.apps.worker`
  - (optional) `.env.apps.gather`
- Use `npm run env:init` to initialize shared env files from `config/env`.
- Runtime env loading is done by `dotenvx` through `scripts/run-with-dotenvx.mjs`.
- Local DB/Redis/MinIO values should match `docker/local/docker-compose.dev.yml`.
- Prisma operations should run from repo root:

```bash
npm run db:migrate
npm run db:seed
```

## 4) Code Style Guidelines

- Use TypeScript for `apps/web` and `apps/worker`.
- Follow existing import aliases (`@/*`, `@oak/agents/*`) and current project structure.
- Keep changes minimal and scoped to task.
- Prefer explicit error handling and typed payloads for API and worker jobs.

## 5) Logging Instructions (Important)

- Use centralized logger module: `apps/web/lib/logger.ts`.
- Do not write logs to tracked files (for example `apps/web/error.log`).
- For API and worker errors, log structured context with `logger.error(...)`.
- Logging env keys:
  - `LOG_LEVEL`: `debug | info | warn | error`
  - `LOG_APP_NAME`: logical service name (`web`, `worker`, etc.)

## 6) Testing Instructions

- Add/adjust tests for behavior changes when practical.
- At minimum, run type checks for the touched workspace(s).
- If unrelated pre-existing failures exist, mention them explicitly in your final note.

## 7) Security Considerations

- Never commit secrets or real API keys in `.env` files.
- Avoid logging tokens, cookies, auth payloads, or personally identifiable data.
- Treat uploaded files and external fetch content as untrusted input.

## 8) Commit and PR Guidance

- Use descriptive, scoped commit messages, e.g.:
  - `feat(web): add source retry endpoint`
  - `fix(worker): handle empty chunk embeddings`
  - `refactor(logging): centralize API error logs`
- Keep one logical change per commit when possible.

## 9) Monorepo Guidance for Nested AGENTS.md

For larger subprojects, add nested `AGENTS.md` files inside each app/package.

- Agents should follow the nearest `AGENTS.md` in the directory tree.
- Nested guidance overrides root guidance for that subproject.
- Keep root file for global standards and local files for app-specific workflows.
