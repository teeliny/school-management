# Build Plan: School Management System

**Status:** Draft v1.0
**Companion to:** [PRD.md](./PRD.md) (what/why) and [ARCHITECTURE.md](./ARCHITECTURE.md) (how/structure) — this document is the *sequencing*: build order, cross-phase dependencies, and a concrete "done" definition per phase, so implementation can start without re-deriving the order from scratch.

---

## 1. Build Order Principles

- **This is a single-tenant application.** One deployment, one database, per school (PRD §2.2). That removes an entire category of foundational work a multi-tenant SaaS would need (tenant resolution, connection-pooling-per-tenant, provisioning automation, migration fleet rollout) — don't reintroduce any of it. Phase 1 below is correspondingly light.
- **Bottom-up through the module dependency table** (ARCHITECTURE §5): `IdentityModule` before `AcademicStructureModule` before `SubjectModule` before `AssessmentModule`, etc. Building out of that order means mocking dependencies you'll throw away in a week.
- **Build the abstractions that are still real, even with one implementation.** `StorageAdapter` (Supabase Storage today) is cheap to build correctly now and expensive to retrofit later (ARCHITECTURE §5, §15) — don't cut it to "save time." The database connection, by contrast, needs no such abstraction — it's ordinary Prisma config, nothing to build there beyond using environment variables properly.
- **Plumbing before logic, where a pattern repeats.** The async dispatch/callback/timeout-sweep pattern is used twice (AI scheduling, ARCHITECTURE §9; Monnify reconciliation, ARCHITECTURE §10) — build it once, generically, the first time it's needed, and reuse it the second time rather than re-solving it.
- **Resist scope creep into PRD Non-Goals** (§1.2, §10) at every phase: no self-registration screens, no in-app "list of schools" or fleet dashboard, no Vault/KMS service, no native mobile, no automated timetable optimization beyond the CP-SAT solver. If a phase's work starts drifting into one of these, that's a signal to stop and check the PRD, not a sign the plan is incomplete.

---

## 2. Phase 0 — Repo & Infra Scaffolding

Not a PRD-numbered phase (PRD §9 starts at product Phase 1) — this is the technical groundwork that has to exist before Phase 1 work can begin.

**Tasks:**
- Monorepo scaffolding (Turborepo or Nx): `apps/api`, `apps/worker`, `apps/web`, `apps/scheduling-engine`, `packages/types`, `packages/eslint-config`, `packages/tsconfig` (ARCHITECTURE §4).
- One Prisma schema, stood up empty — first migration is just "schema exists," real tables come in per phase below.
- `docker-compose.yml`: one local Postgres DB, one local Redis, all four apps building and booting with a bare `/health` endpoint each.
- CI skeleton (GitHub Actions): lint, typecheck, unit test, build, `prisma migrate diff --exit-code` gate (ARCHITECTURE §12) — even with nothing to test yet, get the pipeline shape right early.
- Config/env loading convention, and a stub for the application-level envelope-encryption utility (ARCHITECTURE §7) — not wired to anything yet, but the pattern (encrypt/decrypt helper + where the master key comes from locally vs. in each environment) should exist before the first real secret (`PaymentGatewayConfig`) needs it in Phase 5.

**Done when:** `docker compose up` boots all four apps with working health checks, and an empty PR goes green through the full CI pipeline.

---

## 3. Phase 1 — Foundation: Auth & Core Identity

*(maps to PRD §9 Phase 1)*. Much lighter than it would be in a multi-tenant system — there's no tenant-resolution machinery to build (ARCHITECTURE §6), just ordinary application setup.

**Build in this order:**

1. **Application schema v1** — identity + academic structure only, everything else arrives in later phases as needed: `User`, `UserRole`, `Invitation`, `SchoolProfile`, `AcademicSession`, `Term`, `ClassLevel`, `ClassArm`, `Department` (PRD §3.1, §3.1a, §3.2). Migrate.
2. **Standard Prisma client**, instantiated once at process boot from environment config, injected via normal NestJS DI (ARCHITECTURE §6) — there's no factory, cache, or per-request resolution to build.
3. **Auth**: login (email + password, no tenant/slug step) → verifies credentials against the `User` table → issues JWT (`sub`, `roles`) + refresh token (rotated, Redis-blacklistable) (ARCHITECTURE §7).
4. **Invitation accept flow**: token-hash validation → set password → `User.status = active` → `Invitation.status = ACCEPTED`.
5. **CASL `AbilityFactory` + `PoliciesGuard` skeleton** — build the mechanism now even with only a handful of rules defined; every subsequent phase adds rules to it rather than inventing its own auth pattern. This is the permission boundary that actually matters here, since there's no tenant boundary to also worry about.
6. **New-school setup script** (`pnpm setup:school`, ARCHITECTURE §6.1): seeds `GradeScale`, `SchedulingConstraint`, `NotificationTemplate` defaults, creates the first `SUPER_ADMIN` `Invitation`, sends the email. One-shot, run once per deployment — no job-status table needed.

**Done when:** running the setup script against a fresh deployment gets you from an empty database to "the Proprietor received an email, accepted it, set a password, and logged in to see an empty dashboard." No tenant-isolation test is needed here — there's only ever one school's data in this database, so there's no boundary to prove.

---

## 4. Phase 2 — People

*(maps to PRD §9 Phase 2)*

1. `AdminProfile`, `StaffProfile`, `ParentProfile`, `StudentProfile`, `StudentGuardian` tables + migrations (PRD §3.1).
2. Super-Admin/Admin-driven Staff and Parent invitation flows (extends the Phase 1 `Invitation` mechanism to `invitedRole = ADMIN | STAFF | PARENT`, with Admin-appointment restricted to Super-Admin only, PRD §5, §6.1).
3. Student creation flow: atomic transaction requiring ≥1 `StudentGuardian`, with the inline-parent-invite path when the guardian doesn't already have an account (PRD §6.1 FR1.3).
4. `StaffAssignment` CRUD (class teacher, subject teacher, principal, VP, headteacher) — with `BURSAR`/`REGISTRAR` assignment restricted to Super-Admin only (PRD §5, §6.3 FR3.1).
5. Ownership transfer (PRD FR1.9) — atomic Super-Admin → another user handoff, enforced by the partial unique index on active `SUPER_ADMIN` rows.
6. Role-scoped list views: class teacher sees only her class, parent sees only her wards — the first real exercise of the CASL rules scaffolded in Phase 1.
7. Pending-invitations admin view (resend/revoke).

**Done when:** a full class of students and their parents can be onboarded (bulk import or one-by-one), every permission-scoping rule in PRD §5 is enforced, and each has a permission-boundary e2e test (one test per role, asserting what it *can't* see, not just what it can — e.g. a class teacher assigned to SSS1 Gold can never fetch a student in SSS1 Silver, no matter how the request is shaped).

---

## 5. Phase 3 — Academics

*(maps to PRD §9 Phase 3)*

1. `Subject`, `ClassSubject`, `SubjectGroupWeight`, `StudentSubjectEnrollment` (PRD §3.3).
2. Applicability rules engine: `COMPULSORY` auto-enroll, `GENERAL` opt-in, `DEPARTMENT`-gated (only SSS + matching department), plus `requiresCalculation` as data (consumed later in Phase 7).
3. `Department` + `StudentDepartment`, gated to SSS-category `ClassLevel`s only.
4. Manual `TimetableSlot` CRUD + teacher/venue double-booking conflict detection (PRD §6.6 FR6.1) — this is the class-timetable path that stays manual-or-AI-assisted throughout; the AI half comes in Phase 7.

**Done when:** Admin can define a full subject catalogue including a grouped subject (the PRD's Basic Science and Technology example — one group, four independently-scored children), assign it across class levels for a session, and students correctly auto-enroll or opt in per the type rules — verified with a test per subject type (compulsory, general, department-restricted, grouped).

---

## 6. Phase 4 — Assessment

*(maps to PRD §9 Phase 4)*

1. `AssessmentWindow` with open/close gating (score entry rejected outside an open window, Admin override).
2. `ScoreEntry` with assignment-scoped write permission (only the `SUBJECT_TEACHER` assigned to that subject+class, or Admin override).
3. `SubjectTermResult` aggregation job — including grouped-subject weighting via `SubjectGroupWeight` (child scores roll up into the parent's grade).
4. `GradeScale`, `ReportComment` (role-scoped: subject teacher / class teacher / principal comment types).
5. `TermReportCard` generation (async PDF job, PRD §6.4 FR4.6) + publish gate (checks required comments present before allowing publish).

**Done when:** a full term cycle runs start to finish in a test environment — window opens, subject teachers score (including a grouped subject), window closes, aggregation computes grades correctly, comments are added by the right roles, a report card generates and publishes, and the parent sees it (published-only visibility enforced).

---

## 7. Phase 5 — Operations: Attendance, Fees, Monnify

*(maps to PRD §9 Phase 5)*

1. `AttendanceSession`/`AttendanceRecord` — daily (class teacher) and per-period (subject teacher).
2. `FeeStructure`, `Invoice`, `InvoiceLineItem`, `Payment`, `Receipt`, `PaymentGatewayConfig` — write access scoped to Super-Admin/Bursar only, per PRD §5 footnote 3 (Admin has no visibility into this domain at all). This is the first place the Phase 0 envelope-encryption stub gets wired to a real secret (`PaymentGatewayConfig.apiKey`/`secretKey`).
3. **Monnify integration** (PRD §6.7, ARCHITECTURE §10):
   - Checkout initiation (reference unique per invoice — no tenant-routing concern to design around, ARCHITECTURE §10).
   - Webhook handler: verify signature → resolve `Payment`/`Invoice` directly by reference → idempotency check on `monnifyTransactionReference` → update → generate `Receipt` → notify.
   - Reconciliation polling job for missed webhooks — **this is the first occurrence of the generic async dispatch/timeout-sweep pattern** that Phase 7's AI scheduling reuses; build it as a reusable pattern here rather than a one-off, so Phase 7 doesn't redesign it.

**Done when:** a parent can complete a real (sandbox) Monnify transaction end-to-end and see the invoice flip to paid with a receipt generated — verified via **both** paths independently: the normal webhook path, and a forced-webhook-failure test proving the polling fallback alone resolves the payment (PRD FR7.6).

---

## 8. Phase 6 — Notifications & Polish

*(maps to PRD §9 Phase 6)*

1. WebSocket gateway + Redis adapter, rooms scoped `user:{userId}` (ARCHITECTURE §8) — no tenant prefix needed.
2. `NotificationTemplate` seeded from default templates shipped in the codebase at Phase 1's setup step, `Notification`, `NotificationPreference`.
3. `EmailLog` + Resend delivery webhook handling (bounce/complaint tracking flags the guardian record for follow-up, PRD FR8.4).
4. `AuditLog` wired as a cross-cutting interceptor (ARCHITECTURE §5) across every write path added in Phases 1–5 — this is retroactive coverage, not new business logic, so budget time for it rather than treating it as an afterthought.
5. Performance pass: N+1 query audit across the modules built so far, P95 latency check against the PRD §7 NFR target (<300ms reads).

**Done when:** every PRD FR that says "trigger notification" actually fires both in-app and email, unread counts update live over the socket, critical notification types (report card published, invoice overdue, password reset) can't be muted via `NotificationPreference`, and `AuditLog` has an entry for every sensitive write path added so far (score entries, fee records, role/assignment changes).

---

## 9. Phase 7 — AI Scheduling

*(maps to PRD §9 Phase 7)* — deliberately last, since it depends on `Subject.requiresCalculation` (Phase 3), `StaffAssignment` (Phase 2), and `AssessmentWindow` (Phase 4) all already existing.

1. **Async plumbing first, solver logic second**: `ScheduleGenerationRequest` (PRD §3.8) + BullMQ dispatch job + callback endpoint with per-request `callbackToken` + timeout sweep (ARCHITECTURE §9). If Phase 5's Monnify reconciliation already established this generic async pattern, this step is mostly reuse, not new design.
2. `scheduling-engine` service (Python/FastAPI + OR-Tools CP-SAT): class timetable model — subject/day/period assignment honoring `SchedulingConstraint` rows, `requiresCalculation` morning-placement and spread rules.
3. Extend to exam timetable generation (calculation-subject-first, minimum gap between calculation exams).
4. Extend to invigilation assignment (staff eligibility exclusion: `BURSAR`/`PRINCIPAL`/`VICE_PRINCIPAL`, load balancing, no double-booking).
5. Approval workflow UI: `PENDING_REVIEW → APPROVED`, with the split approval rule from PRD §5 (class timetables: Admin or Super-Admin; exam timetables and invigilation rosters: Admin only, footnote 4).

**Done when:** a realistic SSS1–3 constraint set (real subject list, real staff roster, real `SchedulingConstraint` values) produces a usable draft timetable, exam schedule, and invigilation roster requiring only minor manual edits — verified end-to-end through the full async pipeline, including one deliberately-simulated timeout case that exercises FR6.9.

---

## 10. Cross-Cutting Work (Not Owned by One Phase)

- **Observability** (ARCHITECTURE §13): start minimal in Phase 0 (health checks), extend as each phase introduces a new failure surface (queue depth once BullMQ exists in Phase 1, webhook latency once Monnify exists in Phase 5).
- **Security hardening passes**: one dedicated pass after Phase 2 (once RBAC has real rules to attack — permission-boundary fuzzing, rate-limit verification), and one more before this school goes live (secret-rotation drill for the envelope-encryption master key, dependency audit).
- **CI/CD maturity**: minimal pipeline in Phase 0; add the migration-diff gate alongside Phase 1. If this same pipeline is later templated to deploy multiple schools' independent instances (ARCHITECTURE §12), that templating work happens whenever a second deployment is actually needed — not speculatively now.

---

## 11. Suggested Parallelization (if more than one builder)

- **Track A (backend core)**: Phase 1 foundation → Phase 3/4 academics & assessment. This track owns auth/identity and can't be parallelized much within itself — it's inherently sequential early on.
- **Track B (frontend)**: Next.js shell + design system can start as soon as `packages/types` has stub DTOs for whatever Phase 1 exposes, and stays roughly one phase behind whichever backend phase is active — never blocking, but never far ahead either, since it needs real contracts to build against.
- **Track C (specialists, self-contained)**: Monnify integration (Phase 5) and the AI scheduling engine (Phase 7) don't block and aren't blocked by the academics/assessment work in Phases 3–4 — a specialist (or a second engineer) can pick either up in parallel once Phase 1's async-plumbing pattern exists, rather than waiting for Phase 5/7 to come up in strict sequence.

---

## 12. What Not to Build Early

Resist building these ahead of when the PRD/ARCHITECTURE actually call for them — each is either an explicit Non-Goal or a deferred decision, and building it early is wasted work against a moving target:

- Any tenant-resolution machinery — TenantContextMiddleware-style connection switching, per-tenant client caching, a tenant claim in the JWT. None of it applies here; this is a single-tenant application (ARCHITECTURE §6).
- A Vault/KMS service — application-level envelope encryption is the decided default; don't stand up Vault infrastructure preemptively.
- A fleet-management/multi-school ops dashboard — not needed until the team is actually operating enough separate school deployments that manually tracking them becomes painful (PRD §10, ARCHITECTURE §15), and even then it's explicitly outside this product.
- Anything from PRD §1.2 Non-Goals or §10 Open Questions framed as "deferred" — multi-currency billing, native mobile, fully autonomous (unreviewed) schedule publishing, cross-school single sign-on.
