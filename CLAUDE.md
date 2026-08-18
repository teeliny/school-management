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

```text
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
- **Uniqueness enforced at the DB layer, not application code, whenever the constraint has a `WHERE` clause Prisma's `@@unique` can't express** — two flavors, same underlying pattern (hand-add the index directly to the generated migration SQL; don't rely on a service-layer check alone):
  - *True singletons* (at most one row, ever): `SUPER_ADMIN` role and "current" `AcademicSession`.
  - *At most one active row per key* (duplicates are fine once revoked/soft-deleted): `ReportComment` (`WHERE "subjectId" IS NULL`, for CLASS_TEACHER/PRINCIPAL comment types) and `StaffAssignment` (`WHERE "isActive" = true`, one active `SUBJECT_TEACHER` row per staff+subject+classArm+session — see `staff-assignment.ts`'s `syncSubjectTeacherAssignments`, which reconciles against it with a manual find-diff since a raw partial index can't be targeted by Prisma's typed `.upsert()`).
  If you hit either shape again, follow the matching precedent.
- **Email normalization** happens at the app layer (`UserService.normalizeEmail`), not via Postgres `citext` — keep using that static method rather than lower-casing ad hoc.
- **Mailer**: `MailerService` falls back to `console.log` when `RESEND_API_KEY` is unset — this is intentional for local dev, not a bug.
- **CORS**: both `api` and `worker` read `CORS_ORIGIN` (falling back to `WEB_BASE_URL`) via `parseCorsOrigins()` in `src/common/cors.ts` (duplicated per-app, not shared — keep both in sync if you change the logic). The scheduling engine has its own `CORSMiddleware` reading the same env vars via `os.environ`. If you add a new HTTP-serving app, wire CORS the same way.
- **A `Subject` with `isGroup=true` is never itself assignable or scoreable** — only its `childSubjects` are (PRD §3.3; the group's own grade is a computed weighted average via `SubjectGroupWeight`, done by the worker at report time). `GET /subjects` returns group subjects with children nested, not flattened, so any UI or logic that lists subjects for teacher assignment or score entry must flatten `isGroup` subjects into their `childSubjects` itself — see the `selectableSubjects` `flatMap` in both `staff-assignment-form.tsx` and `gradebook/page.tsx` for the pattern to copy. `ScoreEntryService.enter` also rejects a write against a group `subjectId` outright as a backstop, even under Admin override. This bit us twice (both pickers shipped listing the group directly) before the backstop went in.

## Frontend conventions (apps/web)

- **`docs/school-system-design.html` is the visual design reference** — a static, self-contained HTML mockup (open it directly in a browser) covering login, the sidebar+topbar app shell, and every planned feature panel (dashboard, attendance, gradebook, exam scheduling, fees, notifications, audit log). It's guidance, not shipped code — it defines the fonts, color tokens, spacing, and component shapes the real app should match. **Only build the panels that correspond to features that actually exist per `BUILD_PLAN.md`'s current phase** — don't add mock UI for Attendance/Gradebook/Exam Scheduling/Fees/Audit Log just because the mockup has them; those land when their backend phase does. Its inline `<style>` block is the source of truth if a token or spacing value here ever looks out of sync with it.
- **Component architecture is Atomic Design**, under `apps/web/src/components/`:
  - `atoms/` — smallest styled primitives, one DOM concern each (`Button`, `Input`, `Label`, `Textarea`, `Badge`, `CrestBadge`). Plain native elements unless the interaction is complex enough to need Radix (`Button` uses `@radix-ui/react-slot` for `asChild`; `Input`/`Textarea` are plain styled `<input>`/`<textarea>` — no Radix primitive exists for those). `Button` takes a `size` prop (`"default" | "sm"`) matching the mockup's `.btn`/`.btn-sm` — use that instead of ad-hoc padding/text-size overrides.
  - `molecules/` — small compositions of atoms/Radix primitives: `FormField` (`Label` + `Input`), `Select`, `MultiSelect` (Radix `DropdownMenu` + `CheckboxItem`, not `Select` — Radix's `Select` primitive is single-value only), `DropdownMenu`, `AlertDialog`, `ThemeToggle` (Radix `ToggleGroup`), `Card`/`CardHeader` (the bordered panel used everywhere content is grouped), `Letterhead` (the eyebrow + serif `h1` + double-rule that opens every page). `Select`'s `SelectContent` and `MultiSelect` both default to `max-h-[250px] overflow-y-auto` so every option list in the app scrolls at the same height instead of growing unbounded — don't override this per call site (that's how it drifted before: two call sites had grown their own one-off `max-h-72`).
  - `organisms/` — feature-level compositions with their own state/data-fetching, e.g. `LoginForm`, `AcceptInviteForm`, `PeopleList`, `CreateStudentForm`. These map ~1:1 to what used to live directly in `app/*/page.tsx`.
  - `templates/` — page-level layout shells with no business logic: `AuthLayout` (centers content in a `min-h-screen` viewport, corner `ThemeToggle`) for login/accept-invite, `AppShell` (sidebar nav + topbar with avatar dropdown/logout + `ThemeToggle`) for everything behind auth. Both take fully-formed data as props rather than fetching anything themselves. Compose templates + organisms in `app/*/page.tsx`; keep those page files thin.
  - `providers/` — non-visual context wrappers (`ThemeProvider`). Not part of the atomic hierarchy.
  - When adding a new UI piece, place it by composition level, not by feature — e.g. a new form goes in `organisms/`, not a new top-level folder per page.
- **`useCurrentUser()`** (`src/lib/use-current-user.ts`) is the one place that fetches `/auth/me`, redirects to `/login` if there's no token, and exposes `logout()` — every authenticated page (`dashboard`, `students`, `staff`, `invitations`) uses it instead of re-implementing that fetch/redirect/logout boilerplate. Reuse it for any new authenticated page rather than copy-pasting the old per-page `useEffect`.
- **Everything Radix-first**: any interactive primitive (toggle, select, dropdown, dialog, etc.) should wrap a `@radix-ui/react-*` package rather than being hand-rolled, styled via the same CSS-variable tokens and the `cn()` helper (`clsx` + `tailwind-merge`) in `src/lib/cn.ts`.
- **Theming**: `next-themes`, class-based (`darkMode: "class"` in Tailwind), colors as CSS custom properties in RGB-channel format in `globals.css` (e.g. `--background: 245 238 212`) so Tailwind can apply opacity via `rgb(var(--x) / <alpha-value>)`. Brand colors: navy `#001B3A` / cream `#f5eed4`, inverted between light and dark. Beyond `background`/`foreground`/`primary`/`border`/`muted`, there's `card`/`card-inset` (panel backgrounds — `card` for the panel itself, `card-inset` for recessed form fields inside it) and semantic pairs `success`/`warning`/`danger`/`info`, each with a `-bg` companion (e.g. `--success` for text/icons, `--success-bg` for the tinted chip background) — see the `Badge` atom for the standard usage. Both flow through `tailwind.config.ts` the same way (`success.DEFAULT`, `success.bg`, etc.).
- **Fonts**: loaded via `next/font/google` in `layout.tsx`, exposed as CSS variables and consumed in `globals.css`/`tailwind.config.ts` — Fraunces (`font-display`, serif headings/titles — `CardHeader`, `Letterhead`, `CrestBadge`), IBM Plex Sans (body default), IBM Plex Mono (`font-mono` — anything numeric/tabular: admission numbers, dates, `Badge` text). Don't reintroduce the mockup's `<link>`-tag Google Fonts import; `next/font` is the Next.js-native equivalent and avoids the render-blocking request.
- **The dark-mode gradient background (`globals.css`, `.dark body { background-image: ... }`) is currently dark-mode only** — there's no light-mode equivalent yet. Know this before "fixing" a report that the gradient isn't visible; check which theme is active first.
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
