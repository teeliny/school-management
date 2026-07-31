# School Management System

A school management platform for Nigerian-model schools (Creche/Nursery → Primary 1-6 → JSS1-3 → SSS1-3): user/role management, subjects (including grouped and department-restricted subjects), assessment & reporting, attendance, AI-assisted timetabling, fees (Monnify), and real-time + email notifications.

**Deployment model: single-tenant — one dedicated application instance per school.** This repository is the codebase deployed once per school, not a multi-tenant service. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) §2.2 for why.

## Documentation

| Doc | Answers |
|---|---|
| [docs/PRD.md](./docs/PRD.md) | What is being built, and why — roles, permissions, data model, functional requirements |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | How it's built — components, request flows, deployment topology |
| [docs/BUILD_PLAN.md](./docs/BUILD_PLAN.md) | Build order — what gets built in what sequence, and what "done" looks like per phase |

**Current status:** Phase 1 (Foundation: Auth & Core Identity) complete — invitation-based auth, JWT + refresh tokens, CASL permissions, Academic Structure CRUD, `setup:school`. See docs/BUILD_PLAN.md for what's next.

## Prerequisites

- Node.js 20+ (with [Corepack](https://nodejs.org/api/corepack.html) enabled: `corepack enable`)
- [pnpm](https://pnpm.io) 11.x (installed automatically via Corepack the first time you run a `pnpm` command in this repo)
- Docker (for Postgres/Redis locally, and for building the full stack)
- Python 3.11+ (for `apps/scheduling-engine`)

## Getting Started

```bash
pnpm install

cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
# Fill in a real ENCRYPTION_MASTER_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

pnpm setup:scheduling-engine   # creates apps/scheduling-engine/.venv and installs its deps

pnpm docker:up                  # postgres + redis + all four apps in containers
```

Then check every service is up:

```bash
curl http://localhost:3001/health   # api
curl http://localhost:3002/health   # worker
curl http://localhost:3000/health   # web
curl http://localhost:8000/health   # scheduling-engine
```

## Running Services Individually (native, hot-reload)

For day-to-day development it's usually faster to run Postgres/Redis in Docker but the apps natively, so you get hot-reload:

```bash
docker compose up -d postgres redis

pnpm dev:api                 # NestJS API — :3001
pnpm dev:worker              # NestJS worker (BullMQ consumers) — :3002
pnpm dev:web                 # Next.js — :3000
pnpm dev:scheduling-engine   # FastAPI — :8000 (run `pnpm setup:scheduling-engine` first)
```

Or start everything at once (native, all apps concurrently via Turborepo): `pnpm dev`.

## First-Time School Setup

Once the database is migrated (`pnpm prisma:migrate:dev`), this deployment's very first account — its Super-Admin (Proprietor) — is created by a one-time script, not a sign-up screen (docs/ARCHITECTURE.md §6.1):

```bash
pnpm setup:school \
  --school-name="Example Secondary School" \
  --proprietor-email=proprietor@example.com \
  --proprietor-first-name=Ada \
  --proprietor-last-name=Lovelace
```

This seeds the `SchoolProfile` and emails (or, if `RESEND_API_KEY` isn't set, logs) an invite link. Accepting it at `/accept-invite?token=...` sets the Proprietor's password and activates their account. Safe to re-run — it checks what already exists before creating anything.

## Common Commands

| Command | Does |
|---|---|
| `pnpm build` | Build every app (Turborepo) |
| `pnpm lint` | Lint every app |
| `pnpm typecheck` | Typecheck every TypeScript app |
| `pnpm test` | Run unit tests |
| `pnpm setup:school` | One-time: create this deployment's Super-Admin invite (see above) |
| `pnpm prisma:generate` | Regenerate the Prisma client from `prisma/schema.prisma` |
| `pnpm prisma:migrate:dev` | Create/apply a migration locally |
| `pnpm prisma:migrate:deploy` | Apply pending migrations (production/CI) |
| `pnpm docker:up` / `pnpm docker:down` | Start/stop the full containerized stack |

## Project Structure

```
docs/
  PRD.md               # What/why
  ARCHITECTURE.md      # How
  BUILD_PLAN.md        # Build order
apps/
  api/                 # NestJS — HTTP + WebSocket entrypoint
  worker/              # NestJS — BullMQ consumer entrypoint
  web/                 # Next.js App Router frontend
  scheduling-engine/   # Python/FastAPI — AI timetable/exam scheduling (OR-Tools CP-SAT, Phase 7)
packages/
  types/               # Shared DTOs/Zod schemas, imported by api/worker/web
  tsconfig/            # Shared tsconfig bases
  eslint-config/       # Shared ESLint flat config
prisma/
  schema.prisma        # One schema — this deployment's one database (docs/ARCHITECTURE.md §4)
infra/docker/          # Per-app Dockerfiles
docker-compose.yml     # Local dev: postgres, redis, and all four apps
```

Each school's deployment is a separate, independent instance of everything above — see docs/ARCHITECTURE.md §11.
