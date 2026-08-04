# Build Plan: School Management System

**Status:** Draft v1.0
**Companion to:** [PRD.md](./PRD.md) (what/why) and [ARCHITECTURE.md](./ARCHITECTURE.md) (how/structure) — this document is the *sequencing*: build order, cross-phase dependencies, and a concrete "done" definition per phase, so implementation can start without re-deriving the order from scratch.

---

## 1. Build Order Principles

- **This is a single-tenant application.** One deployment, one database, per school (PRD §2.2). That removes an entire category of foundational work a multi-tenant SaaS would need (tenant resolution, connection-pooling-per-tenant, provisioning automation, migration fleet rollout) — don't reintroduce any of it. Phase 1 below is correspondingly light.
- **Bottom-up through the module dependency table** (ARCHITECTURE §5): `IdentityModule` before `AcademicStructureModule` before `SubjectModule` before `AssessmentModule`, etc. Building out of that order means mocking dependencies you'll throw away in a week.
- **Build the abstractions that are still real, even with one implementation.** `StorageAdapter` (Supabase Storage today) is cheap to build correctly now and expensive to retrofit later (ARCHITECTURE §5, §15) — don't cut it to "save time." The database connection, by contrast, needs no such abstraction — it's ordinary Prisma config, nothing to build there beyond using environment variables properly.
- **Plumbing before logic, where a pattern repeats.** The async dispatch/callback/timeout-sweep pattern is used twice (AI scheduling, ARCHITECTURE §9; payment-gateway reconciliation, ARCHITECTURE §10) — build it once, generically, the first time it's needed, and reuse it the second time rather than re-solving it.
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

*(maps to PRD §9 Phase 4, PRD §3.6, §3.11)*

1. `AssessmentComponent` CRUD (Admin-only) with the per-(term, classLevel) structure-completeness validation (components must sum to 100 before any can open) and the three-date scheduling model (inputOpensAt/inputClosesAt/publishAt) — plus a scheduled sweep (BullMQ, same shape as the payment-gateway reconciliation / scheduling-timeout-sweep pattern in ARCHITECTURE.md §8–§10) that transitions status off those dates, with Admin override always available regardless of schedule.
2. `ScoreEntry` with assignment-scoped write permission (only the `SUBJECT_TEACHER` assigned to that subject+class, or Admin override), gated on the parent component's `OPEN` status.
3. `SubjectTermResult` aggregation job — including grouped-subject weighting via `SubjectGroupWeight` (child scores roll up into the parent's grade) — triggered when a class level's components for a term all close.
4. `GradeScale`.
5. `SkillAssessmentItem` admin config (Admin/Super-Admin, per academic session), including the default-from-previous-session copy behavior on first access for a new session.
6. `ReportWindow` CRUD (Admin-only, per term+class level) gating `SkillRating` entry and `CLASS_TEACHER` `ReportComment` writes — same schedule/override shape as `AssessmentComponent`.
7. `ReportComment` (role-scoped: subject teacher / class teacher / principal comment types).
8. `TermReportCard` generation (async PDF job, PRD FR4.8) — both a `MID_TERM` (auto-generated when the MID_TERM component closes, no gate beyond PDF completion) and `FULL_TERM` (publish gate checking subject results + skill ratings + both required comments are present) variant, per the design added to PRD §3.6. Both include the school logo/address (from `SchoolProfile`) and the generation date in the PDF header; the `FULL_TERM` attendance line is deferred to Phase 5 (PRD §3.7). **Revised post-initial-build, now implemented** (PRD §3.6/FR4.4a): `MID_TERM` shows only the `MID_TERM` component's score per subject (normalized to a percentage of that component's `maxScore`), each graded + given a remark via `GradeScale`, plus an overall percentage + grade line (no remark). `FULL_TERM` shows the per-subject `GradeScale` remark, a full overall average/grade/remark line, a per-component score breakdown, additive prior-term total columns (ordered by `Term.startDate`), and — for whichever term is chronologically last in the session — per-subject grade/remark/position and the overall summary computed from each subject's average across every term in the session (`SubjectTermResultService.computeAnnualSummary`), not that term's total alone. Added `SubjectTermResult.remark` and `TermReportCard.overallScore`/`overallGrade`/`overallRemark` columns; reworked `apps/worker/src/report-card/report-card.processor.ts`'s `generateMidTerm`/`generateFullTerm` and both content builders in `report-card-content.util.ts` accordingly.
9. `GET /calendar` read-aggregation endpoint (PRD §3.11) across `Term`, `AssessmentComponent`, `ReportWindow` dates, plus a basic calendar UI. **Frontend now built end-to-end** (Track B, `apps/web`): Assessment Setup (`/assessment-setup`, Admin-only manager CRUD for all five config resources), Gradebook (`/gradebook`, assignment- and window-scoped score entry), Skills & Comments (`/skills-comments`, three role-conditional sections for class-teacher ratings/comment, subject comment, principal comment), Report Cards (`/report-cards`, Admin generate/publish + role-scoped list with PDF links), and Calendar (`/calendar`, date-range list grouped by day). Along the way, fixed a `StudentService.findAllForUser` scoping gap where a STAFF user holding only a `PRINCIPAL`/`HEADTEACHER` assignment (no `CLASS_TEACHER`/`SUBJECT_TEACHER`) got an empty student list — now school-wide visibility, matching Admin, same as the real-world remit.

**Done when:** a full term cycle runs start to finish in a test environment for at least two class levels with *different* component structures (e.g. one with a single 20-point CA, another with two 10-point CAs) — components open/close/publish on schedule and via Admin override, subject teachers score within their windows, aggregation computes correct totals for both structures, the skill list defaults correctly from a prior session (and can be built from scratch when there is none), class teachers rate skills and comment within their window, principal comments, a report card generates and publishes only once every required piece is present, the parent sees it (published-only visibility enforced), and every scheduled date involved shows up correctly on `GET /calendar`.

---

## 7. Phase 5 — Operations: Attendance, Fees, Payments (Monnify default + Paystack)

*(maps to PRD §9 Phase 5)*

1. `AttendanceSession`/`AttendanceRecord` — daily (class teacher) and per-period (subject teacher). Also build the "school-days-opened" auto-calculation design decided during Phase 4 (PRD §3.7): term date range minus weekends minus declared public holidays (a new holiday-declaration concept, e.g. `SchoolHoliday`), counted per a school-wide `DAILY`/`MORNING_AND_AFTERNOON` granularity setting — this is what backfills the `FULL_TERM` `TermReportCard`'s attendance line that Phase 4 ships without (PRD §3.6).
2. `FeeStructure`, `Invoice`, `InvoiceLineItem`, `Payment`, `Receipt`, `PaymentGatewayConfig`, `DiscountRequest` — write access scoped to Super-Admin/Bursar only, per PRD §5 footnote 3 (Admin has no visibility into this domain at all); approval of `PENDING_APPROVAL` payments and `DiscountRequest`s is Super-Admin only, not Bursar (PRD §6.7). This is the first place the Phase 0 envelope-encryption stub gets wired to a real secret (`PaymentGatewayConfig.apiKey`/`secretKey`, now one encrypted row per provider rather than a single singleton row).
3. **`PaymentGatewayAdapter` interface first, provider adapters second** (PRD §6.7, ARCHITECTURE §5, §10) — same "build the abstraction even with one implementation" principle as `StorageAdapter` (§1): define `initTransaction`/`verifyTransaction`/`verifyWebhookSignature` once, then implement `MonnifyAdapter` (bound by default, `PAYMENT_GATEWAY_PROVIDER=MONNIFY`) and `PaystackAdapter` behind it. `FeesModule` and the webhook controller call only the interface.
   - Checkout initiation (reference unique per invoice — no tenant-routing concern to design around, ARCHITECTURE §10).
   - Webhook handler: verify signature via the active adapter → resolve `Payment`/`Invoice` directly by reference → idempotency check on `gatewayTransactionReference` → update (recording which `gatewayProvider` handled it) → generate `Receipt` → notify.
   - Reconciliation polling job for missed webhooks, per the `Payment`'s own recorded `gatewayProvider` — **this is the first occurrence of the generic async dispatch/timeout-sweep pattern** that Phase 7's AI scheduling reuses; build it as a reusable pattern here rather than a one-off, so Phase 7 doesn't redesign it.
4. **Manual bank-transfer payment workflow** (PRD FR7.3a/FR7.3b, ARCHITECTURE §10.2): Bursar submits a `Payment(method=BANK_TRANSFER_MANUAL)` with a proof-of-payment file via `StorageAdapter` → `PENDING_APPROVAL`; Super-Admin reviews (approve → `SUCCESSFUL`, generate `Receipt`, notify Bursar + parent; reject → `REJECTED` with reason, notify Bursar). This is a synchronous approval action, not a queued job — it doesn't touch the `payment-reconciliation` queue from step 3.
5. **Discount request workflow** (PRD FR7.8, ARCHITECTURE §10.3): Bursar raises a `DiscountRequest` against an invoice (termly by construction, since an invoice is already per-term); Super-Admin approves (adds a `DISCOUNT` `InvoiceLineItem`, recomputes outstanding balance) or rejects (notify Bursar with reason).
6. **Receipts and payment history** (PRD FR7.4/FR7.4a, ARCHITECTURE §10.4): unify receipt generation across all three paths above (gateway webhook/poll, manual approval, cash entry); build the parent-facing invoice/receipt history view and the Bursar/Super-Admin school-wide payment ledger view.

**Done when:** a parent can complete a real (sandbox) transaction end-to-end on the **default (Monnify)** gateway and see the invoice flip to paid with a receipt generated — verified via **both** paths independently: the normal webhook path, and a forced-webhook-failure test proving the polling fallback alone resolves the payment (PRD FR7.6) — **and** the same checkout flow works against the Paystack sandbox after only flipping `PAYMENT_GATEWAY_PROVIDER` (no code change), proving the adapter abstraction actually holds. Additionally: a Bursar-submitted manual bank-transfer payment reaches a parent's confirmed invoice only after Super-Admin approval (never before, and never approvable by Bursar or Admin); a rejected submission notifies the Bursar with a reason and never touches the invoice; a Bursar-raised discount request changes the invoice's outstanding balance only after Super-Admin approval, correctly scoped to that one term's invoice; and a parent, Bursar, and Super-Admin can each pull up historical payment records at the appropriate scope (own wards vs. school-wide).

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

*(maps to PRD §9 Phase 7)* — deliberately last, since it depends on `Subject.requiresCalculation` (Phase 3), `StaffAssignment` (Phase 2), and `AssessmentComponent` (Phase 4) all already existing.

1. **Async plumbing first, solver logic second**: `ScheduleGenerationRequest` (PRD §3.8) + BullMQ dispatch job + callback endpoint with per-request `callbackToken` + timeout sweep (ARCHITECTURE §9). If Phase 5's payment-gateway reconciliation already established this generic async pattern, this step is mostly reuse, not new design.
2. `scheduling-engine` service (Python/FastAPI + OR-Tools CP-SAT): class timetable model — subject/day/period assignment honoring `SchedulingConstraint` rows, `requiresCalculation` morning-placement and spread rules.
3. Extend to exam timetable generation (calculation-subject-first, minimum gap between calculation exams).
4. Extend to invigilation assignment (staff eligibility exclusion: `BURSAR`/`PRINCIPAL`/`VICE_PRINCIPAL`, load balancing, no double-booking).
5. Approval workflow UI: `PENDING_REVIEW → APPROVED`, with the split approval rule from PRD §5 (class timetables: Admin or Super-Admin; exam timetables and invigilation rosters: Admin only, footnote 4).

**Done when:** a realistic SSS1–3 constraint set (real subject list, real staff roster, real `SchedulingConstraint` values) produces a usable draft timetable, exam schedule, and invigilation roster requiring only minor manual edits — verified end-to-end through the full async pipeline, including one deliberately-simulated timeout case that exercises FR6.9.

---

## 10. Cross-Cutting Work (Not Owned by One Phase)

- **Observability** (ARCHITECTURE §13): start minimal in Phase 0 (health checks), extend as each phase introduces a new failure surface (queue depth once BullMQ exists in Phase 1, gateway webhook latency and pending-manual-approval count once payments exist in Phase 5).
- **Security hardening passes**: one dedicated pass after Phase 2 (once RBAC has real rules to attack — permission-boundary fuzzing, rate-limit verification), and one more before this school goes live (secret-rotation drill for the envelope-encryption master key, dependency audit).
- **CI/CD maturity**: minimal pipeline in Phase 0; add the migration-diff gate alongside Phase 1. If this same pipeline is later templated to deploy multiple schools' independent instances (ARCHITECTURE §12), that templating work happens whenever a second deployment is actually needed — not speculatively now.

---

## 11. Suggested Parallelization (if more than one builder)

- **Track A (backend core)**: Phase 1 foundation → Phase 3/4 academics & assessment. This track owns auth/identity and can't be parallelized much within itself — it's inherently sequential early on.
- **Track B (frontend)**: Next.js shell + design system can start as soon as `packages/types` has stub DTOs for whatever Phase 1 exposes, and stays roughly one phase behind whichever backend phase is active — never blocking, but never far ahead either, since it needs real contracts to build against.
- **Track C (specialists, self-contained)**: the payment gateway integration (Phase 5) and the AI scheduling engine (Phase 7) don't block and aren't blocked by the academics/assessment work in Phases 3–4 — a specialist (or a second engineer) can pick either up in parallel once Phase 1's async-plumbing pattern exists, rather than waiting for Phase 5/7 to come up in strict sequence. Within Phase 5 itself, the `PaystackAdapter` is a natural second-engineer task once the `PaymentGatewayAdapter` interface and `MonnifyAdapter` exist — it doesn't touch `FeesModule`'s core invoice/receipt logic.

---

## 12. What Not to Build Early

Resist building these ahead of when the PRD/ARCHITECTURE actually call for them — each is either an explicit Non-Goal or a deferred decision, and building it early is wasted work against a moving target:

- Any tenant-resolution machinery — TenantContextMiddleware-style connection switching, per-tenant client caching, a tenant claim in the JWT. None of it applies here; this is a single-tenant application (ARCHITECTURE §6).
- A Vault/KMS service — application-level envelope encryption is the decided default; don't stand up Vault infrastructure preemptively.
- A fleet-management/multi-school ops dashboard — not needed until the team is actually operating enough separate school deployments that manually tracking them becomes painful (PRD §10, ARCHITECTURE §15), and even then it's explicitly outside this product.
- Anything from PRD §1.2 Non-Goals or §10 Open Questions framed as "deferred" — multi-currency billing, native mobile, fully autonomous (unreviewed) schedule publishing, cross-school single sign-on.
