# CLAUDE.md

Guidance for Claude Code (and any future you) working in this repo.

## What this is

Single-tenant school management platform (Nigerian-model schools). NestJS API + NestJS worker (BullMQ) + Next.js web + Python/FastAPI scheduling engine, one Postgres database, pnpm workspaces + Turborepo monorepo.

**Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/BUILD_PLAN.md` before making non-trivial changes.** They are the source of truth for what/why/build-order and are kept up to date — check `BUILD_PLAN.md` for current phase status before assuming a feature doesn't exist yet. `README.md` has full setup/run instructions; don't duplicate that here.

Critical framing decisions already made (don't relitigate without asking):
- **Single-tenant** — this repo is deployed once per school, not a multi-tenant SaaS. See ARCHITECTURE.md §2.2.
- **Super-Admin = the school's Proprietor**, not a platform-level role. It's a singleton (enforced by a partial unique index, see below).
- **Invitation-only auth** — there is no public sign-up. The first account (Super-Admin) is created via `pnpm setup:school`; everyone else is invited.

## Commands

```bash
pnpm dev                 # all apps, native, hot-reload (needs docker compose up -d postgres redis first)
pnpm dev:api / dev:worker / dev:web / dev:scheduling-engine
pnpm build / pnpm lint / pnpm typecheck / pnpm test   # Turborepo, runs across all apps
pnpm prisma:generate / prisma:migrate:dev / prisma:migrate:deploy
pnpm setup:school --school-name=... --proprietor-email=... --proprietor-first-name=... --proprietor-last-name=...
```

Run `pnpm typecheck` and `pnpm lint` (scoped to the app you touched, e.g. `pnpm --filter=@school/api lint`) before considering backend work done — there's no pre-commit hook enforcing it.

## Repo layout

```
apps/api/                 NestJS — HTTP entrypoint, port 3001
apps/worker/               NestJS — BullMQ consumers, port 3002
apps/web/                  Next.js App Router, port 3000
apps/scheduling-engine/    Python/FastAPI (OR-Tools CP-SAT), port 8000 — Phase 7, not built yet
packages/types/            Shared DTOs/Zod schemas — import from here, don't redefine
packages/tsconfig/         Shared tsconfig bases (base.json / nestjs.json / nextjs.json)
packages/eslint-config/    Shared flat ESLint config
prisma/schema.prisma       ONE schema for the whole deployment (not per-app)
infra/docker/              Per-app Dockerfiles
```

## Backend conventions (apps/api, apps/worker)

- **Auth**: JWT access tokens (short-lived, signed) + opaque refresh tokens hashed and stored in Redis (same hashing pattern as `Invitation` tokens — see `apps/api/src/identity/invitations`). `JwtAuthGuard` establishes *who*; `PoliciesGuard` (CASL) establishes *what they can do*. Both are applied per-controller; see `apps/api/src/academic-structure/*` for the standard pairing plus `@CheckPolicies(...)`.
- **RBAC**: CASL (`@casl/ability`). Abilities are built per-request in `AbilityFactory.createForUser`. Add new permissions there, not with ad-hoc role checks in controllers.
- **Modules**: service + controller are combined in one file per resource under `academic-structure/` — follow that pattern for similarly small CRUD resources rather than splitting into separate files.
- **Validation**: `class-validator` + `class-transformer` on DTOs, `ValidationPipe({ transform: true })` globally. For any Postgres `@db.Date`/`@db.Timestamp` field, use `@Type(() => Date)` + `@IsDate()`, **not** `@IsDateString()` — the latter accepts bare `"2025-09-01"` which Prisma's client rejects. This bit us once already.
- **Singletons enforced at the DB layer, not application code**: `SUPER_ADMIN` role and "current" `AcademicSession` both use hand-written partial unique indexes in the migration SQL (Prisma's schema DSL can't express `WHERE` clauses on unique indexes). If you add another singleton concept, follow the same pattern — add the partial index directly to the generated migration file, don't rely on a service-layer check alone.
- **Email normalization** happens at the app layer (`UserService.normalizeEmail`), not via Postgres `citext` — keep using that static method rather than lower-casing ad hoc.
- **Mailer**: `MailerService` falls back to `console.log` when `RESEND_API_KEY` is unset — this is intentional for local dev, not a bug.
- **CORS**: both `api` and `worker` read `CORS_ORIGIN` (falling back to `WEB_BASE_URL`) via `parseCorsOrigins()` in `src/common/cors.ts` (duplicated per-app, not shared — keep both in sync if you change the logic). The scheduling engine has its own `CORSMiddleware` reading the same env vars via `os.environ`. If you add a new HTTP-serving app, wire CORS the same way.

## Frontend conventions (apps/web)

- **Theming**: `next-themes`, class-based (`darkMode: "class"` in Tailwind), colors as CSS custom properties in RGB-channel format in `globals.css` (e.g. `--background: 245 238 212`) so Tailwind can apply opacity via `rgb(var(--x) / <alpha-value>)`. Brand colors: navy `#001B3A` / cream `#f5eed4`, inverted between light and dark.
- **The dark-mode gradient background (`globals.css`, `.dark body { background-image: ... }`) is currently dark-mode only** — there's no light-mode equivalent yet. Know this before "fixing" a report that the gradient isn't visible; check which theme is active first.
- **UI primitives**: `apps/web/src/components/ui/*` wraps Radix primitives (`@radix-ui/react-*`) styled with the same CSS-variable tokens, combined via the `cn()` helper (`clsx` + `tailwind-merge`) in `src/lib/cn.ts`. Use these (`Label`, `Input`, `Textarea`, `Select`, `DropdownMenu`, theme toggle's `ToggleGroup`) instead of raw HTML form elements or a different component library.
- **Icons**: `lucide-react`.

## Docker / infra gotchas

- **Prisma client generation must happen after `COPY . .`** in every Dockerfile — `@prisma/client`'s postinstall runs `prisma generate` before the schema file exists in the build context otherwise, producing an empty client (`Module has no exported member 'X'` errors for every model). See `infra/docker/api.Dockerfile` for the working pattern (explicit `prisma generate --schema prisma/schema.prisma` step in the build stage, with a dummy `DATABASE_URL` — generate doesn't connect to the DB).
- `node:*-slim` images need `apt-get install openssl` in the base stage or Prisma picks the wrong engine binary and warns/fails at runtime.
- Jest configs across `api`/`worker` use `passWithNoTests: true` — an app with zero spec files should not fail the root `pnpm test`.

## Environment

Root `.env` (not `apps/web/.env.local`) is read by `api`/`worker`/`scheduling-engine`. Next.js only reads env from `apps/web/` itself. See `.env.example` for the full annotated list — most vars are self-explanatory; `ENCRYPTION_MASTER_KEY` must be a real 32-byte base64 value even in dev (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

## Working style notes

- This session verifies claims empirically (curl against running services, actual `docker build`, `tsc`/`jest` runs) rather than assuming code is correct from a read-through — keep doing that, several real bugs were only caught this way.
- The user hand-edits files directly in parallel with Claude's changes sometimes (e.g. commenting out real email sends in favor of `console.log` during local dev, adding debug `console.log`s). Don't revert those without being asked — treat them as intentional local dev state, not accidents to clean up.
