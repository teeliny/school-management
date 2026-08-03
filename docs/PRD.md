# Product Requirements Document: School Management System

**Status:** Draft v1.0
**Owner:** Taiwo Yinusa
**Last updated:** 2026-07-20

---

## 1. Overview

A school management platform serving Nigerian-model schools (Creche/Nursery → Primary 1-6 → JSS1-3 → SSS1-3), covering user/role management, academic structure, subject management (including grouped and department-restricted subjects), assessment & reporting, attendance, timetabling, fee/billing management, and real-time + email notifications.

**Deployment model: single-tenant — one dedicated application instance per school.** Each school runs its own separate deployment (its own database, its own running application, its own domain) rather than sharing infrastructure with any other school. If the product is used by multiple schools, that means multiple independent deployments of the same codebase, not one shared multi-tenant service. See §2.2.

### 1.1 Goals

- Give each school a fully isolated, dedicated deployment (its own database, its own application instance) to manage users, classes, subjects, assessments, attendance, timetables, and fees — no shared infrastructure or code path that could ever reach another school's data.
- Model real-world staff/parent overlap (a staff member can also be a parent) and multi-role staff assignments (a teacher can be a class teacher, subject teacher, and bursar simultaneously) without data duplication.
- Support the Nigerian senior-secondary subject model: compulsory, general, and department-restricted subjects, plus grouped subjects with per-component scoring aggregated into one subject grade.
- Enforce strict, role-scoped data visibility (e.g., a class teacher sees only her class; a parent sees only her wards).
- Guarantee referential integrity between students and parents — no orphan student accounts.
- Deliver assessment/report workflows gated by admin-controlled windows.
- Provide real-time in-app notifications (WebSocket) and transactional email (Resend) as first-class, robust infrastructure — not an afterthought.

### 1.2 Non-Goals (v1)

- Public self-registration of any kind — there is no sign-up screen anywhere in the product. The school's very first account (its Super-Admin/Proprietor) is created via a one-time setup step run at deployment time, not through any in-app screen (see §6.1). Every account after that is created by invitation: Super-Admin invites Admins, Super-Admin/Admin invite Staff and Parents, and Student records are created directly by Admin/Staff.
- Learning management (course content delivery, e-learning videos) — out of scope.
- Native mobile apps (responsive web only in v1; API is mobile-ready for future native apps).
- Multi-currency billing (single currency in v1).
- Fully autonomous schedule publishing without human review — AI-generated schedules always require human approval before they go live: class timetables by Admin or Super-Admin, exam timetables and invigilation rosters by Admin only (see §5, §6.6).
- Operating or managing multiple schools' deployments from within the product itself — there is no in-app "list of schools" or fleet dashboard. Standing up a new school's deployment, or updating an existing one, is an operational/deployment activity outside the application (see §2.2, ARCHITECTURE.md §11).

### 1.3 Target Users

| Role | Description |
|---|---|
| Super-Admin (Proprietor) | The school's owner — singleton per school. Everything Admin can do, plus owner-only powers: appointing/removing Admins, billing/subscription, ownership transfer |
| Admin | School-level administrator (principal's office / management, full day-to-day control within their school) |
| Staff — Teaching | Subject/class teachers, can hold additional role assignments |
| Staff — Non-teaching | Bursar, registrar, other administrative staff |
| Parent/Guardian | Linked to one or more students (wards) |
| Student | Always linked to at least one parent/guardian |

These five roles are the only personas the application itself models. Deploying and operating a school's instance (or many schools' instances, if the same team runs several) is a DevOps/infrastructure activity outside the product — there is no in-app "operator" role.

---

## 2. System Architecture

### 2.1 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), TypeScript, React Query/TanStack Query, Tailwind CSS |
| Backend | NestJS, TypeScript, REST (+ WebSocket Gateway) |
| Database | PostgreSQL — one dedicated database per school deployment. Connection details come from environment configuration, not hardcoded to any specific vendor's SDK, so the database can be hosted anywhere Postgres runs and moved later by changing config and redeploying — see §2.2 |
| ORM | Prisma — a single, standard, injected client per running instance; no dynamic multi-database resolution needed |
| Auth | JWT (access + refresh), Passport.js strategies, RBAC guards |
| Real-time | NestJS WebSocket Gateway (Socket.IO adapter) |
| Email | Resend (transactional email API) |
| Caching / pub-sub | Redis — recommend a serverless/pay-per-request provider (e.g. Upstash) over a provisioned always-on cluster, since cost tracks actual usage instead of a fixed monthly instance fee (session/refresh-token blacklist, WebSocket pub-sub across instances, notification fan-out) |
| File storage | S3-compatible object storage (documents, profile photos, report card PDFs) — today, likely Supabase Storage (also S3-compatible), accessed only through a generic storage interface (ARCHITECTURE.md §5) so switching to AWS S3 or another S3-compatible provider later is a config change, not an application rewrite |
| Secrets / encryption | Application-level envelope encryption (e.g. libsodium secretbox or AES-256-GCM) with a single master key held in the hosting platform's own secret store — **not** a paid KMS or a self-hosted Vault server, to avoid a recurring bill and an extra service to operate for what is, at this stage, a handful of encrypted fields (§7) |
| Background jobs | BullMQ (Redis-backed) — report generation, email sending, scheduled notifications, exam-schedule generation callbacks (§6.6) |
| Scheduling / AI optimization | Constraint-based scheduling engine (Google OR-Tools CP-SAT) as a small, separate, **serverless** Python service (scale-to-zero) — exam/invigilation scheduling is bursty and infrequent (a few runs per term), so paying only per invocation is materially cheaper than an always-on container for this workload. Called asynchronously; results arrive via callback, not a held-open request (§6.6) |
| Monorepo tooling | Turborepo or Nx (shared `types`/`dto` package between apps/api and apps/web) |
| Infra | Docker Compose (dev), CI via GitHub Actions, one deployment per school |
| Payments | Monnify (Nigerian payment gateway) — reserved/virtual accounts and hosted checkout (card, bank transfer, USSD) for parent fee payments, webhook-based reconciliation. Each school configures its own Monnify merchant credentials; fees are never intermediated by anything outside the school's own deployment |

### 2.2 Deployment Model: Single-Tenant, One Application Per School

- **Isolation by deployment, not by database row or shared-instance boundary.** Each school gets its own complete, independent deployment: its own database, its own running application (API + worker + web), its own domain. There is no shared runtime, shared database instance, or shared code path between two schools' deployments — if the product serves 10 schools, that's 10 separate installs of the same codebase, not one service juggling 10 tenants. This is the strongest form of isolation available: not "a query could theoretically leak across a boundary that's supposed to prevent it," but "there is no other school's data reachable from any given running instance, full stop."
- **No `schoolId` column anywhere, and no dynamic tenant resolution.** Because a deployment only ever holds one school's data, there's nothing to scope queries against — every table in §3 is exactly as it would be in any ordinary single-tenant application. There is no per-request "which database do I talk to" step, no tenant claim in the JWT, no request-scoped connection switching. A standard Prisma client is instantiated once at application boot from environment configuration and used for the lifetime of the process (ARCHITECTURE.md §6).
- **Provider flexibility is still preserved, just simpler.** The database connection string, storage credentials, and Monnify credentials are all environment configuration, not hardcoded to a specific vendor — moving a school's database to a different Postgres host later is a config change plus a redeploy (and a one-time data migration if the old host needs decommissioning), not an application code change. There's no need for a runtime "provisioning adapter" abstraction here, because nothing in the running application ever creates a new database at runtime — that's an infrastructure action taken once, outside the app, when a school's deployment is first stood up.
- **Onboarding a new school = deploying a new, independent instance.** This is a deployment/infrastructure activity (a script, an IaC module, or a hosting platform's "new app" flow), not an in-app feature: provision a new database, set that deployment's environment configuration (DB connection, Monnify credentials, secrets), run migrations, run the one-time setup step that seeds defaults and creates the school's first Super-Admin invitation (§6.1). There is no in-app screen for this, and no in-app role that performs it — whoever operates the infrastructure (the school itself, or a vendor/consultant setting it up on their behalf) runs this once per school.
- **Multiple schools on the same codebase is expected and fine — think "one codebase, many independent installs,"** the way a self-hosted application is deployed once per customer, not "one server, many customers." Updating the product for every school means redeploying each school's independent instance (potentially via a shared, parameterized CI/CD pipeline template if the same team operates many), not a single fleet-wide database migration step inside the application.
- **Cross-school data sharing or lookup is architecturally impossible**, not merely disallowed. A staff member who is also a parent still resolves to a single `User` row — but only within their own school's database. A person associated with two different schools needs two entirely separate accounts (different deployments, different databases, different credentials, no shared identity or single sign-on) — see §10.

### 2.3 High-Level Module Map

1. **Identity & Access** — user table, role tables, invitation-based auth, RBAC
2. **School & Academic Structure** — school profile, session, term, class/level, department
3. **Subject Management** — subjects, subject groups, class-subject assignment, department restriction
4. **Enrollment** — student-class-session enrollment, class assignment history
5. **Staff Assignment** — staff-role assignments (class teacher, subject teacher, bursar, etc.)
6. **Assessment & Reporting** — assessment components, score entry, aggregation, report cards, comments
7. **Attendance** — daily/per-period attendance for students and staff
8. **Timetable & Exam Scheduling** — class/subject/teacher schedule, AI-assisted class & exam timetable generation, AI-assisted invigilation assignment, admin approval workflow
9. **Fees & Billing** — fee structures, invoices, payments, receipts
10. **Notifications** — in-app (WebSocket) + email (Resend)

---

## 3. Data Model

> Every table below lives in the **one database this deployment owns** for its one school. There is no `schoolId` column anywhere — there is nothing else in this database to distinguish a row from.

### 3.1 Core Identity Tables

**`User`** (central table — one row per human, regardless of role)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | citext, unique | login identifier |
| phone | string, nullable | |
| passwordHash | string, nullable | argon2; null until an invited user accepts and sets a password |
| firstName, lastName, middleName | string | |
| gender | enum | |
| dateOfBirth | date, nullable | |
| avatarUrl | string, nullable | |
| status | enum: `invited`, `active`, `suspended`, `archived` | starts `invited` for every account except directly-created Student records (§6.1) |
| lastLoginAt | timestamptz, nullable | |
| createdAt, updatedAt, deletedAt | timestamptz | soft delete |

**`UserRole`** (many-to-many; a user can hold multiple base roles over time, though typically one)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| userId | uuid FK → User | |
| role | enum: `SUPER_ADMIN`, `ADMIN`, `STAFF`, `PARENT`, `STUDENT` | exactly one active `SUPER_ADMIN` row at a time, enforced via a partial unique index (`WHERE role = 'SUPER_ADMIN' AND "isActive"`) — this is the school's Proprietor, see §1.3 |
| isActive | boolean | |
| createdAt | timestamptz | |

> Design rationale: rather than a rigid 1:1 `User→type`, `UserRole` lets one `User` row be both `STAFF` and `PARENT` (the explicit staff-can-also-be-parent case) without duplicating identity/auth data. Type-specific detail tables below hang off `userId`, not off `UserRole`, since profile data (name, contact) is shared but role-specific data (staff employment info vs. parent occupation) is not.

**`AdminProfile`** — id, userId FK (1:1), title/designation, employeeId.

**`StaffProfile`** — id, userId FK (1:1), employeeId, staffCategory (`TEACHING` | `NON_TEACHING`), department (nullable, HR department not academic), employmentDate, qualification, isClassTeacher (denormalized flag, derived from `StaffAssignment`), status.

**`ParentProfile`** — id, userId FK (1:1), occupation, address, relationshipToStudentDefault (nullable — actual relationship is per-student via `StudentGuardian`).

**`StudentProfile`** — id, userId FK (1:1), admissionNumber (unique), admissionDate, currentClassId FK → `ClassArm` (nullable until enrolled), studentTitle (`PREFECT` | `CLASS_REP`/`CAPTAIN` | null, see §3.5), bloodGroup, medicalNotes, status.

**`StudentGuardian`** (join table — enforces the "no student without a parent" rule)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| studentId | uuid FK → StudentProfile | |
| parentId | uuid FK → ParentProfile | |
| relationship | enum: FATHER, MOTHER, GUARDIAN, OTHER | |
| isPrimaryContact | boolean | |
| isEmergencyContact | boolean | |

**Constraint:** enforced at the application/service layer (transactional) — a `StudentProfile` cannot be created without at least one `StudentGuardian` row in the same transaction. Additionally, a DB-level deferred constraint trigger checks on transaction commit that every `StudentProfile` has ≥1 `StudentGuardian`, as defense-in-depth against direct DB writes.

### 3.1a Invitations

All account creation other than direct Student record creation goes through this table — there is no self-service sign-up anywhere in the product (§1.2, §6.1).

**`Invitation`**

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | citext | recipient |
| invitedRole | enum: `SUPER_ADMIN`, `ADMIN`, `STAFF`, `PARENT` | `SUPER_ADMIN` is only ever used once — the very first invite for this deployment, created by the one-time setup step (§6.1) for the school's Proprietor. Student accounts are never invited directly — see §6.1 |
| staffCategory | enum, nullable | prefill for STAFF invites (`TEACHING`/`NON_TEACHING`) |
| invitedByUserId | uuid FK → User, nullable | null only for that first `SUPER_ADMIN` invite, created by the setup script before any `User` exists to be the sender |
| tokenHash | string | SHA-256 of the raw token; the raw token exists only in the emailed link, never stored |
| status | enum: `PENDING`, `ACCEPTED`, `EXPIRED`, `REVOKED` | |
| expiresAt | timestamptz | default `now() + 7 days`, configurable |
| acceptedAt | timestamptz, nullable | |
| createdAt | timestamptz | |

- Accepting an invite (via the single-use link) creates or reactivates the `User` row, sets a password, flips `User.status` to `active`, and marks the `Invitation` `ACCEPTED`.
- Super-Admin/Admin have a pending-invitations view listing PENDING/EXPIRED invites, with resend (issues a new token, invalidates the old one) and revoke actions.
- If a person invited as `STAFF` is later linked as a `StudentGuardian`, the system grants their existing `User` row an additional `PARENT` `UserRole` rather than sending a second invite — one person, one account.
- **Ownership transfer** (Super-Admin → another existing user, e.g. promoting an Admin to Proprietor) does not go through this table — it's a direct, atomic role-swap action, not an invite/accept flow, since the target is normally already a user in this school's system. See FR1.9 in §6.1.

### 3.2 School & Academic Structure

- **`SchoolProfile`** — a **singleton row** (exactly one, for this school) — id, name, address, logoUrl, contactEmail, contactPhone, currency, timezone, academic defaults.
- **`AcademicSession`** — id, name (e.g. "2025/2026"), startDate, endDate, isCurrent (boolean, exactly one true row at a time).
- **`Term`** — id, academicSessionId, name (Term 1/2/3), startDate, endDate, isCurrent.
- **`ClassLevel`** — id, name (e.g. "SSS1"), order (int, for sorting), category (enum: CRECHE, NURSERY, PRIMARY, JSS, SSS).
- **`ClassArm`** — id, classLevelId, name (e.g. "SSS1 Gold"), academicSessionId (arms are re-created or carried per session, configurable), capacity.
- **`Department`** — id, name (SCIENCE, COMMERCIAL, ART), description. Applicable only to SSS-category class levels.
- **`StudentDepartment`** — studentId, departmentId, academicSessionId — assigns a student to a department, only valid when `ClassLevel.category = SSS`.

### 3.3 Subject Management

- **`Subject`** — id, name, code, type (enum: `COMPULSORY`, `GENERAL`, `DEPARTMENT`), departmentId (nullable, required when type=DEPARTMENT), isGroup (boolean), parentSubjectId (nullable FK → Subject, self-referential — set on child subjects belonging to a group), requiresCalculation (boolean, default false — flags numerically/computationally intensive subjects such as Mathematics, Physics, Chemistry, Accounting, Further Maths; consumed as a scheduling constraint by the AI timetable/exam generator, see §3.8 and §6.6).
  - Example: `Basic Science and Technology` row has `isGroup=true`. Four child rows (`Basic Science`, `Basic Technology`, `Information Technology`, `PHE`) each have `parentSubjectId` pointing to it. Children are taught, tested, and scored independently; the parent aggregates.
- **`ClassSubject`** — id, classLevelId (or classArmId, see note below), subjectId, academicSessionId, isCompulsoryOverride (nullable — admin can override default applicability per class). This table is the source of truth for "which subjects exist for which class this session," and CRUD on it is Admin or Super-Admin only.
- **`SubjectGroupWeight`** — id, groupSubjectId, childSubjectId, weight (decimal, e.g. 25.00 for equal 4-way split, or custom weights) — defines how child scores aggregate into the parent's reported grade.

**Applicability rules (enforced in service layer at enrollment/assessment time):**
- `COMPULSORY`: auto-applies to every student in the assigned class.
- `GENERAL`: available to any student in the assigned class; student/admin opts in via `StudentSubjectEnrollment`.
- `DEPARTMENT`: only students whose `StudentDepartment` matches `Subject.departmentId` may enroll; only valid for `ClassLevel.category = SSS`.

- **`StudentSubjectEnrollment`** — id, studentId, subjectId, classArmId, academicSessionId, termId, status (active/dropped). Auto-created for COMPULSORY subjects on class enrollment; explicit for GENERAL/DEPARTMENT.

### 3.4 Staff Roles & Assignments

Distinct from the base `UserRole = STAFF`, a staff member holds one or more **functional assignments**, which drive permissions and dashboards.

**`StaffAssignment`**

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| staffId | uuid FK → StaffProfile | |
| assignmentType | enum: `SUBJECT_TEACHER`, `CLASS_TEACHER`, `BURSAR`, `REGISTRAR`, `PRINCIPAL`, `VICE_PRINCIPAL`, `HEADTEACHER`, `OTHER` | |
| classArmId | uuid FK, nullable | required for CLASS_TEACHER |
| subjectId | uuid FK, nullable | required for SUBJECT_TEACHER |
| academicSessionId | uuid FK | assignments are per-session (re-affirmed or changed yearly) |
| startDate, endDate | date, nullable | |
| isActive | boolean | |

- A `SUBJECT_TEACHER` assignment ties a staff member to a specific `Subject` + `ClassArm` pair — this is what grants score-entry permission (§5.2).
- Administrative titles (`PRINCIPAL`, `VICE_PRINCIPAL`, `HEADTEACHER`, `REGISTRAR`, `BURSAR`) carry elevated, module-specific permissions (e.g. `BURSAR` → fee module write access) defined in the permission matrix (§5). `BURSAR` and `REGISTRAR` are a special case: they report organizationally to Super-Admin rather than Admin, so their `StaffAssignment` can only be created or revoked by Super-Admin (§6.3), and their respective domains (finance; exam schedules & academic records) are invisible to Admin entirely (§5).
- A staff member can simultaneously hold `CLASS_TEACHER` (SSS1 Gold), `SUBJECT_TEACHER` (Mathematics, multiple arms), and `BURSAR` — all represented as separate `StaffAssignment` rows.

### 3.5 Student Titles

- **`StudentProfile.studentTitle`**: nullable enum (`PREFECT`, `CLASS_REP`, `CLASS_CAPTAIN`, or a more general `StudentPosition` table if the school needs multiple simultaneous titles, e.g. Head Boy + Prefect). Recommend a separate **`StudentPosition`** table (studentId, positionName, scope [`SCHOOL`|`CLASS`], classArmId nullable, academicSessionId) to allow multiple concurrent titles cleanly rather than a single enum column.

### 3.6 Assessment & Reporting

Scoring structure is **configurable per class level, per term** — different class levels (e.g. Primary vs. SSS) can run different CA splits in the same term. The system does not hardcode a 20/20/60 split; it enforces only that a class level's defined components for a term sum to 100. (Recommended default when Admin sets up a new term: one or two CA components summing to 20, one Mid-Term component of 20, one Exam component of 60 — but Admin can add/resize components freely as long as the total holds.)

- **`AssessmentComponent`** — id, termId, classLevelId, type (enum: `CA`, `MID_TERM`, `EXAM`), name (e.g. "1st CA", "2nd CA", "Mid-Term Test", "Terminal Exam"), sequence (int — distinguishes multiple components of the same type, e.g. CA1 vs CA2), maxScore (decimal), inputOpensAt (timestamptz), inputClosesAt (timestamptz), publishAt (timestamptz — when scores under this component become visible to students/parents, distinct from `inputClosesAt`), status (enum: `DRAFT`, `OPEN`, `CLOSED`, `PUBLISHED`), createdByUserId. Unique per (termId, classLevelId, type, sequence). **Created/edited by Admin only.** Status transitions automatically off the three date fields (a scheduled sweep, mirroring the pattern in ARCHITECTURE.md §9/§10) but Admin can override any transition manually (force-open, force-close, force-publish/unpublish) — same "scheduled by default, Admin override always available" shape as the old `AssessmentWindow`.
  - **Structure-completeness check**: before any component for a given (termId, classLevelId) can move to `OPEN`, the system validates that the full set of components defined for that pair sums to 100 — catches an incomplete setup (e.g. Exam defined but Mid-Term forgotten) before staff start entering scores against a structure that can't produce a valid total.
- **`ScoreEntry`** — id, studentId, subjectId (child subject if grouped), assessmentComponentId, classArmId, score, enteredByStaffId, enteredAt, updatedAt. Unique per (studentId, subjectId, assessmentComponentId). Write permission: only the `SUBJECT_TEACHER` assigned to that subject+classArm for the current session, and only while the component's status is `OPEN` (or Admin, as override, any time).
- **`SubjectTermResult`** — computed/materialized: sums a student's `ScoreEntry` rows across all of that term+class-level's `AssessmentComponent`s for a subject into a total (out of 100, by construction of the structure-completeness rule above), a grade letter **and remark** (both via `GradeScale` — the remark is the matched `GradeScale` row's own `remark` field, not separately entered), and position-in-class (optional). For grouped subjects, aggregates child-subject `SubjectTermResult` rows using `SubjectGroupWeight` into the parent subject's result.
- **`GradeScale`** — id, minScore, maxScore, grade (A1, B2, ... or A-F), remark, gradePoint (nullable, for GPA-style schools). **Admin/Super-Admin configures grade + remark together, per row** — a subject's (or the report's overall) remark is never entered separately; it's always whatever remark the matching `GradeScale` row for that score carries.

**Psychomotor & Affective/Cognitive Skills** (class-teacher-completed, per student per term — two separate, admin-configurable lists, not graded subjects):
- **`SkillAssessmentItem`** — id, academicSessionId, category (enum: `PSYCHOMOTOR`, `AFFECTIVE_COGNITIVE`), name (e.g. "Handwriting", "Sports/Games" under Psychomotor; "Punctuality", "Neatness", "Leadership" under Affective/Cognitive), order (int), isActive. Unique per (academicSessionId, category, name). **Admin/Super-Admin configures this list once per academic session.** When Admin first opens the config screen for a session with no items yet, the system defaults it from the most recent prior session's list (copied, not referenced — the new session gets its own editable rows); if there is no prior session with any items (first-ever session), Admin must build the list from scratch before it can be used.
- **`SkillRating`** — id, studentId, termId, skillAssessmentItemId, rating (enum: `EXCELLENT`, `VERY_GOOD`, `GOOD`, `FAIR`, `POOR`), ratedByStaffId, createdAt/updatedAt. Unique per (studentId, termId, skillAssessmentItemId). Write permission: the `CLASS_TEACHER` of the student's class only (or Admin override), and only while the relevant `ReportWindow` (below) is `OPEN`.

**Report input scheduling:**
- **`ReportWindow`** — id, termId, classLevelId, inputOpensAt, inputClosesAt, status (enum: `DRAFT`, `OPEN`, `CLOSED`), createdByUserId. Unique per (termId, classLevelId). Governs **both** `SkillRating` entry and the `CLASS_TEACHER` `ReportComment` for that term+class level — both are end-of-term class-teacher tasks and share one schedule. Same auto-transition-with-override behavior as `AssessmentComponent`. `PRINCIPAL`/`HEADTEACHER` comments are **not** window-gated — they're role-scoped only, expected to happen after the class-teacher window closes as a matter of workflow, not enforced by a date.
- **`ReportComment`** — id, studentId, termId, commentType (enum: `SUBJECT` [per subject, by subject teacher — not window-gated, follows the relevant `AssessmentComponent`'s own status instead], `CLASS_TEACHER` [gated by `ReportWindow`, see above], `PRINCIPAL`/`HEADTEACHER`), subjectId (nullable, required when `SUBJECT`), authorStaffId, comment, createdAt/updatedAt. Only the assigned staff for the relevant scope may write.

**`TermReportCard`** — id, studentId, termId, reportType (enum: `MID_TERM`, `FULL_TERM` — added during Phase 4 implementation, not in the original design), generatedAt, generatedByUserId, pdfUrl (nullable, generated async via job), scoresSnapshot (jsonb — `MID_TERM` only, see below), **overallScore, overallGrade, overallRemark** (added post-Phase-4, see below — implemented as a single `overallScore` column, an average out of 100 for `FULL_TERM` and a normalized percentage for `MID_TERM`, same `GradeScale` lookup either way, just labeled "Average" vs "Percentage" in the PDF; `overallRemark` is `FULL_TERM`-only), status (enum: `GENERATING`, `READY`, `PUBLISHED`, `FAILED`), publishedAt. Unique per (studentId, termId, reportType) — the two types are the same underlying record shape, distinguished by when they're generated and what gates their publish:

- **`MID_TERM`** — generated automatically the moment the term's `MID_TERM`-type `AssessmentComponent` closes (no Admin trigger needed). **Design revised** (superseding the original Phase 4 build): shows only that one component's score per subject (e.g. "Mid-Term Test /20"), not a cumulative CA+Mid-Term subtotal — a subject teacher's CA scores are still `OPEN`/entering at this point in a typical term calendar, so a running total would be misleading. Each subject's score is **normalized to a percentage of that component's `maxScore`** (since a component isn't always out of 100) and matched against `GradeScale` the same way a `SubjectTermResult` is, giving each subject a **grade + remark** — captured into `scoresSnapshot` for auditability (mid-term has no `SubjectTermResult` rows to read back from later, since components other than `MID_TERM` may still be open). No comments/skills required to generate or publish (`READY` is the only gate) — that stays true; only the "no grade" part of the original design is reversed.
- **`FULL_TERM`** — the original design's report card. **Publish gate**: before allowing publish, checks — a `SubjectTermResult` exists for every subject the student is actively enrolled in; a `SkillRating` exists for every active `SkillAssessmentItem` in both categories; a `CLASS_TEACHER` comment exists; a `PRINCIPAL`/`HEADTEACHER` comment exists. Strictness configurable, per the original design.

**Overall summary (both types, added after initial Phase 4 build)**: in addition to the per-subject grade+remark above, both report types show one summary line, computed the same way a single subject's grade is (matched against `GradeScale`) — but the fields shown differ by type:

- `FULL_TERM` shows **overall average, overall grade, and overall remark** — the mean of each `SubjectTermResult.totalScore` for the subjects actually shown on the card (non-grouped subjects plus each grouped subject's **parent** row only, never double-counting a group's children alongside its parent).
- `MID_TERM` shows **overall percentage and overall grade only, no overall remark** — the mean of the same normalized-to-percentage scores used for its per-subject grades above.

This isn't a new source-of-truth table — it's computed at generation time and stored as new fields alongside the rest of the report (`TermReportCard.overallScore`/`overallGrade`/`overallRemark`, plus mirrored into `scoresSnapshot` for `MID_TERM`), the same "computed, not entered" shape as everything else in this section.

**`FULL_TERM` per-component breakdown + cross-term columns (added after initial Phase 4 build)**: the subject table isn't just a single `Total` column — it shows the per-term breakdown and, once more than one term's results exist in the session, prior terms' totals too:

- **Per-component breakdown**: every `AssessmentComponent` for that (term, classLevel) gets its own column (e.g. `1st CA`, `2nd CA`, `Exam`), read from the underlying `ScoreEntry` rows the same way `MID_TERM` generation already does — not just the `SubjectTermResult.totalScore`, which stays as the "This Term" total column.
- **Prior-term columns are additive across the session**: a Term 2 report adds one column (Term 1's `SubjectTermResult.totalScore` per subject); a Term 3 report adds two (Term 1 and Term 2). Terms are ordered by `startDate` within the same `academicSessionId` (`Term` has no explicit ordinal field today — this relies on date ordering, not name-matching against "Term 1/2/3" strings, so it isn't tied to how many terms a school runs or what it calls them). A subject the student wasn't enrolled in during a given prior term simply shows blank for that column, not zero.
- **The last term of the session grades on the annual average, not that term's own total**: for whichever term is chronologically last in its `academicSessionId` (not hardcoded as "the 3rd term" — a school could run a different number of terms), each subject's **grade, remark, and position** are computed from the **average of that subject's `SubjectTermResult.totalScore` across every term in the session that has one** (missing terms excluded from the average, not treated as zero), matched against `GradeScale` the same as any single-term grade — not from the final term's own total in isolation. The **overall summary** (average/grade/remark) for that same report is likewise the mean of the subjects' annual averages, not the mean of the final term's totals alone. Every other term's report keeps grading on its own term's total, unaffected.
- This means "position" itself changes meaning on the final term's report — ranking classmates by their annual average per subject, not by that one term's total — which needs computing at report-generation time (query every student's `SubjectTermResult` rows across the session's terms, average, then rank), not read from an already-persisted per-term position.

Only published report cards are visible to parents/students; class/subject teachers (STAFF) see their own class's cards regardless of status (PRD §5).

**PDF header (both types)**: school logo and address (from `SchoolProfile`) and the generation date (`generatedAt`), in addition to the student's identifying details and term.

**Attendance line (`FULL_TERM` only — deferred, not built in Phase 4)**: the final report card should show the student's attendance as "days present / school-days-opened this term." This is blocked on Attendance (§3.7, Phase 5) not existing yet — Phase 4 ships `FULL_TERM` without this line. §3.7 below records the auto-calculation design already decided for when Phase 5 builds it, so this doesn't need re-deriving later.

**Workflow:** Admin defines each class level's `AssessmentComponent`s for the term (validated to sum to 100) → components open on schedule (or Admin override) → subject teachers enter `ScoreEntry` while open → components close and later publish on schedule → aggregation job computes `SubjectTermResult` on close → in parallel, the term's `ReportWindow` opens for each class level → class teachers rate `SkillAssessmentItem`s and write their `CLASS_TEACHER` comment while it's open → window closes → subject teachers add `SUBJECT` comments, principal/headteacher adds their comment → Admin (or an automated job once all required pieces are present) triggers `TermReportCard` generation → Admin publishes → parents/students see it (published-only), scoped to what's been published per-component where partial visibility matters.

### 3.7 Attendance

- **`AttendanceSession`** — id, classArmId, date, period (nullable — null = daily attendance; set = per-period), takenByStaffId, type (STUDENT | STAFF).
- **`AttendanceRecord`** — id, attendanceSessionId, personId (studentId or staffId, polymorphic via `personType`), status (enum: PRESENT, ABSENT, LATE, EXCUSED), remark.
- Staff attendance: taken by Admin/Registrar. Student attendance: taken by subject teacher (per period) or class teacher (daily), scoped to their assignment.
- **"School-days-opened" (design decided during Phase 4, not yet built — feeds the `FULL_TERM` `TermReportCard`'s attendance line, §3.6)**: the count of "times school opened" in a term is **auto-calculated**, never manually entered, from the term's date range minus weekends minus declared public holidays. Counting granularity is **school-wide configurable**, not per-term: `DAILY` (one count per school day) or `MORNING_AND_AFTERNOON` (two counts per school day — morning and afternoon sessions counted separately, doubling both the denominator and however "present" is recorded per session). This requires a declared-holiday concept (a school closure date, scoped to an academic session or term) that doesn't exist yet either — whatever Phase 5 introduces for it (e.g. a `SchoolHoliday`/`PublicHoliday` table) must subtract from the raw weekday count before it's used as the report card's attendance denominator. A student's "days present" is the corresponding count of their own `AttendanceRecord.status = PRESENT` rows over the same period/granularity.

### 3.8 Timetable, Exam Scheduling & Invigilation

- **`TimetableSlot`** — id, classArmId, subjectId, staffId, academicSessionId, termId, dayOfWeek (enum), startTime, endTime, venue (nullable), generatedBy (enum: `MANUAL`, `AI`), approvalStatus (enum: `DRAFT`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`), approvedByUserId (nullable), approvedAt (nullable). Admin/Registrar-managed CRUD, or produced by the AI scheduling engine (§6.6) and gated behind approval before it is visible to staff/students/parents. Validated for teacher/venue double-booking conflicts at the service layer regardless of origin.
- **`ExamSchedule`** — id, assessmentComponentId (FK → `AssessmentComponent` — the `EXAM`-type component for that class level+term), classArmId, subjectId, date, startTime, endTime, venue, generatedBy, approvalStatus, approvedByUserId, approvedAt. Exam slots are generated per assessment component (e.g. the class level's "Terminal Exam" component) separately from `TimetableSlot`, since exam sequencing constraints (calculation-subject placement, spread across the exam period) differ from routine class periods.
- **`InvigilationAssignment`** — id, examScheduleId FK → `ExamSchedule`, staffId, role (enum: `LEAD`, `ASSISTANT`), generatedBy, approvalStatus, approvedByUserId, approvedAt. Eligible staff pool excludes anyone holding an active `BURSAR`, `PRINCIPAL`, or `VICE_PRINCIPAL` `StaffAssignment` (§6.6).
- **`SchedulingConstraint`** — id, scope (enum: `CLASS_TIMETABLE`, `EXAM_TIMETABLE`, `INVIGILATION`), key (e.g. `CALCULATION_SUBJECTS_MORNING`, `SPREAD_CALCULATION_SUBJECTS`, `MIN_GAP_BETWEEN_CALCULATION_EXAMS_DAYS`, `MAX_INVIGILATIONS_PER_STAFF_PER_DAY`, `EXCLUDED_INVIGILATION_ASSIGNMENT_TYPES`), value (jsonb), isActive. Lets Admin tune the AI generator's rules without a code change; seeded with sensible defaults (see §6.6) at initial setup, including `EXCLUDED_INVIGILATION_ASSIGNMENT_TYPES = [BURSAR, PRINCIPAL, VICE_PRINCIPAL]`.
- **`ScheduleGenerationRequest`** — id, scope (enum: `CLASS_TIMETABLE`, `EXAM_TIMETABLE`, `INVIGILATION`), classArmId (nullable, for class-timetable scope), assessmentWindowId (nullable, for exam/invigilation scope), status (enum: `QUEUED`, `SOLVING`, `COMPLETED`, `FAILED`, `TIMED_OUT`), requestedByUserId, requestedAt, completedAt (nullable), errorMessage (nullable). Tracks an **in-flight** AI generation run — the solver call is asynchronous (§6.6, ARCHITECTURE.md §9), so this row is what exists *before* any `TimetableSlot`/`ExamSchedule`/`InvigilationAssignment` rows are written, and is what a scheduled timeout sweep checks to catch a run that never got a callback.

### 3.9 Fees & Billing

- **`FeeStructure`** — id, classLevelId (nullable — can apply to a level or school-wide), academicSessionId, termId, name (e.g. "Tuition", "PTA Levy"), amount, isMandatory.
- **`Invoice`** — id, studentId, termId, totalAmount, status (unpaid/partial/paid/overdue), dueDate, generatedAt, monnifyPaymentReference (nullable — Monnify's reference for this invoice's checkout, generated at invoice time; unique per invoice, e.g. `INV-{invoiceId}-{timestamp}` — no cross-deployment ambiguity to resolve, since a webhook to this deployment can only ever mean this school).
- **`InvoiceLineItem`** — id, invoiceId, feeStructureId, amount, description.
- **`Payment`** — id, invoiceId, amount, paidByUserId (parent, nullable for manual entries), method (enum: `MONNIFY_CARD`, `MONNIFY_TRANSFER`, `MONNIFY_USSD`, `MONNIFY_RESERVED_ACCOUNT`, `CASH`, `OTHER_MANUAL`), monnifyTransactionReference (nullable — Monnify's own transaction ID, used for idempotency/reconciliation), status (enum: `PENDING`, `SUCCESSFUL`, `FAILED`, `REVERSED`), paidAt, recordedByStaffId (nullable, for manual/cash entries by Bursar).
- **`Receipt`** — id, paymentId, receiptNumber (unique), pdfUrl.
- **`PaymentGatewayConfig`** — a **singleton row** (exactly one, for this school) — id, provider (enum: `MONNIFY`; extensible for future gateways), apiKey (encrypted at rest, application-layer envelope encryption — not just relying on disk encryption), secretKey (encrypted at rest), contractCode, reservedAccountEnabled (boolean), environment (enum: `SANDBOX`, `LIVE`), isActive. Configured by Super-Admin/Bursar during fee module setup — the school pays into its **own** Monnify merchant wallet; nothing outside this deployment ever touches or intermediates the school's fee money.
- Bursar (`StaffAssignment.assignmentType = BURSAR`) has write access to `FeeStructure`, `Invoice`, `Payment`, `PaymentGatewayConfig`. Parents have read access + payment initiation (via Monnify checkout) for their own wards' invoices only.

### 3.10 Notifications

- **`NotificationTemplate`** — id, key (e.g. `REPORT_CARD_PUBLISHED`), channel (IN_APP | EMAIL | BOTH), subject, bodyTemplate (supports variable interpolation), isCustomized (boolean). Seeded from default templates shipped in the codebase at initial setup (§6.1); Admin can customize this school's copy.
- **`Notification`** — id, recipientUserId, type, title, body, data (jsonb, deep-link payload), isRead, readAt, createdAt.
- **`EmailLog`** — id, recipientEmail, templateKey, resendMessageId, status (queued/sent/delivered/bounced/failed), error (nullable), sentAt.
- **`NotificationPreference`** — id, userId, notificationType, inAppEnabled, emailEnabled (per-user opt-out for non-critical notification types; critical ones like report card publication are non-optional).

### 3.11 Academic Calendar

**No new source-of-truth table.** The calendar is a read-aggregation across dates that already live in their owning tables — `Term.startDate/endDate`, `AssessmentComponent.inputOpensAt/inputClosesAt/publishAt`, `ReportWindow.inputOpensAt/inputClosesAt`, and (once Phase 7 exists) `ExamSchedule.date`. Duplicating these into a separate calendar-events table would create a second source of truth that drifts from the real one; instead, a `GET /calendar` endpoint queries across the owning tables for a given date range and returns a unified, computed list of `{ type, title, date, endDate?, meta }` entries. Visibility is not sensitive — these are scheduling dates, not scores — so any authenticated user can read the calendar; what differs per role is which event types are relevant to show by default in the UI (e.g. a parent's calendar view emphasizes publish dates, a subject teacher's emphasizes their own input windows), which is a frontend filtering concern, not a backend authorization one.

---

## 4. Entity Relationship Summary (textual)

```
AcademicSession 1—* Term
ClassLevel 1—* ClassArm
User 1—1 {AdminProfile | StaffProfile | ParentProfile | StudentProfile}  (via userId, role-gated by UserRole)
User 1—* UserRole
User 1—* Invitation (invitedByUserId)
StudentProfile *—* ParentProfile   (via StudentGuardian, min 1 guardian enforced)
StudentProfile *—1 ClassArm (currentClassId)
StudentProfile *—1 Department (via StudentDepartment, SSS only)
Subject 1—* Subject (self-ref, group→children via parentSubjectId)
Subject *—* ClassLevel (via ClassSubject)
StudentProfile *—* Subject (via StudentSubjectEnrollment)
StaffProfile 1—* StaffAssignment
StaffAssignment *—1 ClassArm (nullable) / *—1 Subject (nullable)
AssessmentComponent 1—* ScoreEntry
ScoreEntry *—1 StudentProfile, *—1 Subject
ReportWindow 1—* SkillRating, 1—* ReportComment (CLASS_TEACHER type)
SkillAssessmentItem 1—* SkillRating
StudentProfile 1—* TermReportCard (per term)
ClassArm 1—* TimetableSlot
AssessmentComponent 1—* ExamSchedule
ExamSchedule 1—* InvigilationAssignment
StudentProfile 1—* Invoice 1—* Payment 1—1 Receipt
(singleton) PaymentGatewayConfig
User 1—* Notification
```

---

## 5. Roles & Permissions Matrix

| Capability | Super-Admin | Admin | Class Teacher | Subject Teacher | Bursar/Registrar | Parent | Student |
|---|---|---|---|---|---|---|---|
| Appoint/remove Admin accounts¹ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Appoint/revoke Bursar or Registrar assignment¹ ³ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View/manage billing & subscription¹ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Transfer ownership (Super-Admin role)¹ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| CRUD subjects | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| CRUD class/session/term structure | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View list of all user types | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View own class students only | ✅ (all) | ✅ (all) | ✅ (own class only) | ✅ (own assigned classes only, for their subject) | ❌ | ❌ | ❌ |
| View own wards | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ (self only) |
| Open/close assessment components | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Enter scores | ✅ (override) | ✅ (override) | ❌ (unless also subject teacher) | ✅ (own subject/class only) | ❌ | ❌ | ❌ |
| Enter subject/class comments | ✅ (override) | ✅ (override) | ✅ (class comment, own class) | ✅ (subject comment, own subject/class) | ❌ | ❌ | ❌ |
| Publish report cards | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View report cards | ✅ (all) | ✅ (all) | ✅ (own class) | ✅ (own subject entries) | ❌ | ✅ (own wards, published only) | ✅ (self, published only) |
| View/manage academic & exam records (entire school)³ | ✅ | ❌ | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Manage fee structure / invoices³ | ✅ | ❌ | ❌ | ❌ | ✅ (Bursar) | ❌ | ❌ |
| Make/view payments³ | ✅ (view) | ❌ | ❌ | ❌ | ✅ (record) | ✅ (own wards) | ❌ |
| Take attendance | ✅ (all) | ✅ (all) | ✅ (own class, daily) | ✅ (own class/subject, per-period) | ✅ (staff attendance, Registrar) | ❌ | ❌ |
| Manage class timetable (manual) | ✅ | ✅ | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Manage exam schedule (manual)³ | ✅ | ❌ | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Trigger AI class timetable generation | ✅ | ✅ | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Trigger AI exam timetable & invigilation generation³ | ✅ | ❌ | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Approve/publish AI-generated class timetables | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve/publish AI-generated exam schedules & invigilation rosters⁴ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Eligible for invigilation duty | ❌² | ✅ (unless also Principal/VP) | ✅ | ✅ | ❌ (Bursar excluded by rule) | ❌ | ❌ |

¹ Owner-only capabilities — exclusive to Super-Admin even though Super-Admin otherwise has every Admin permission plus these. Admin does not gain them even as an "Admin+" superset.

² A Super-Admin/Proprietor isn't necessarily a teaching or non-teaching staff member (no guaranteed `StaffAssignment`), so invigilation duty doesn't apply by default; if a Proprietor is also separately registered as Staff, ordinary staff eligibility rules apply to that assignment.

³ Bursar and Registrar report directly to Super-Admin (Proprietor), not to Admin — Admin has no visibility into fee/finance data or the broader academic/exam records domain those two roles manage. This mirrors real-world reporting lines where these two functions bypass the principal's office and report straight to the owner. Admin retains full authority over everything else, including class (non-exam) timetabling and day-to-day academics.

⁴ Exception to footnote ³: even though Registrar's exam-scheduling work reports to Super-Admin, final approval/publish of an AI-generated exam schedule or invigilation roster is treated as a day-to-day operational sign-off, not an ownership matter — so it sits with Admin, not Super-Admin. Admin sees a schedule only once it reaches `PENDING_REVIEW` for this approval step; that's narrower than Registrar's/Super-Admin's standing "view/manage academic & exam records" access.

Enforcement: NestJS `@Roles()` + `@RequirePermission()` decorators backed by CASL (attribute-based access control) or custom guards — role alone is insufficient for scoped rules like "class teacher sees only her class," which require row-level ownership checks (staff's active `StaffAssignment` records) evaluated per-request, not just role name.

---

## 6. Functional Requirements

### 6.1 Identity & Access
- FR1.1: The school's initial Super-Admin (Proprietor) account is created via a **one-time setup step run at deployment time** — a script (not an in-app screen) that seeds default data (grade scale, scheduling constraints, notification templates) and creates a `SUPER_ADMIN` `Invitation` for the Proprietor's email. No Super-Admin account or login exists until that invite is accepted. Whoever runs the deployment (the school itself, or a vendor/consultant setting it up) never sets a password on the Proprietor's behalf — they only trigger the invite.
- FR1.2: Super-Admin invites Admin accounts (appointing an Admin is an owner-only action); Super-Admin and Admin can both invite Staff and Parent accounts. Each invite creates a `User` (status `invited`) + `Invitation` row and sends a single-use, expiring accept link via Resend. There is no self-service sign-up screen anywhere in the product.
- FR1.3: Admin, Super-Admin, or Staff (with permission) creates Student records **directly** (not via invite, since many students are minors without independent email). Creation requires linking ≥1 existing Parent, or inline-creating a new Parent — which itself sends that Parent an `Invitation` — all within the same atomic transaction; a `StudentProfile` is never persisted without a valid `StudentGuardian` row.
- FR1.4: Invitations are single-use, hashed at rest, and expire after 7 days by default (configurable). Super-Admin/Admin have a pending-invitations view with resend (invalidates the prior token) and revoke actions.
- FR1.5: A single `User` can hold both `STAFF` and `PARENT` roles on one account — e.g. a staff member subsequently linked as a `StudentGuardian` gains the `PARENT` role on their existing account rather than receiving a second invite. Login routes to a role-switch UI if multiple active roles exist.
- FR1.6: Login is a standard single-application login (email + password) — there is no tenant or school-selection step, since this deployment only ever serves one school. The issued JWT carries the user's roles as a claim; there is no tenant identifier to carry, since none is needed.
- FR1.7: JWT access token (short-lived, ~15 min) + refresh token (long-lived, rotated, stored hashed, revocable via Redis blacklist on logout/password change).
- FR1.8: Password reset via emailed link (Resend), token single-use, expires in 1 hour — same token-hash pattern as invitations.
- FR1.9: Super-Admin can transfer ownership to another existing user (e.g. promoting an Admin) in a single atomic action — the outgoing Super-Admin is demoted to `ADMIN`, the target user is promoted to `SUPER_ADMIN`. The partial unique index on active `SUPER_ADMIN` rows (§3.1) guarantees the school is never without exactly one owner mid-transfer, and the action is recorded in `AuditLog`.

### 6.2 Subjects
- FR2.1: Admin CRUDs `Subject` records including type (COMPULSORY/GENERAL/DEPARTMENT) and department linkage.
- FR2.2: Admin defines subject groups (parent + children) and per-child aggregation weights.
- FR2.3: Admin assigns subjects to class levels per session via `ClassSubject`; system auto-enrolls students in COMPULSORY subjects on class assignment.
- FR2.4: DEPARTMENT-type subjects are only assignable/enrollable for SSS-category class levels and only to students in the matching department; system rejects mismatched enrollment attempts.
- FR2.5: Students/Admin manage GENERAL subject opt-in within an enrollment window set by Admin.

### 6.3 Staff & Assignments
- FR3.1: Super-Admin or Admin assigns/revokes most `StaffAssignment` types (class teacher, subject teacher, principal, vice principal, headteacher), scoped per academic session. `BURSAR` and `REGISTRAR` assignments are the exception — only Super-Admin can create or revoke them, reflecting that these two positions report directly to the Proprietor rather than Admin (§5).
- FR3.2: A staff member's effective permissions are computed from their active assignments at request time (no permission caching beyond request scope, to reflect same-day reassignment).
- FR3.3: System prevents assigning two active class teachers to the same `ClassArm` in the same session (validation, not hard DB constraint, to allow deliberate co-teaching overrides by Admin).

### 6.4 Assessment & Reporting
- FR4.1: Admin defines `AssessmentComponent`s per term per class level (type, name, sequence, maxScore, input-open/close, publish date); the full set for a given term+class level must sum to 100 before any component in it can open. Score entry is rejected outside an `OPEN` component (except Admin override).
- FR4.2: Subject teacher enters scores only for students in their assigned class+subject, only while the relevant component is open; system validates assignment and component status on every write.
- FR4.3: For grouped subjects, each child subject is scored independently; a background job recomputes the parent subject's aggregate whenever a child score changes.
- FR4.4: System computes `SubjectTermResult` (summed total across the term's components for that class level, grade letter + remark via `GradeScale`) automatically when a class level's last open `AssessmentComponent` for the term closes.
- FR4.4a: Both `TermReportCard` types additionally show one overall average, grade, and remark — the mean of the displayed subjects' scores (never double-counting a grouped subject's children alongside its own parent row), matched against `GradeScale` the same way a single subject is (§3.6).
- FR4.5: Admin/Super-Admin configures the `SkillAssessmentItem` list (Psychomotor + Affective/Cognitive categories) once per academic session; the system defaults a new session's list from the most recent prior session's, editable from there; if no prior list exists, Admin must create one before it can be used.
- FR4.6: Admin defines a `ReportWindow` per term per class level; while open, class teachers rate every active `SkillAssessmentItem` and write their `CLASS_TEACHER` comment for each student in their class.
- FR4.7: Subject teachers, class teachers, and Admin/Principal add role-scoped `ReportComment`s; report card generation checks all required pieces are present (subject results, skill ratings, class-teacher comment, principal comment) before allowing publish (configurable strictness).
- FR4.8: Report card PDF generation runs as an async job (BullMQ); parent/student sees "generating" state until complete.
- FR4.9: Published report cards trigger notification (in-app + email) to student and all linked guardians.
- FR4.10: All `AssessmentComponent`/`ReportWindow` dates are surfaced on the Academic Calendar (§3.11) as soon as Admin sets them, regardless of current status.

### 6.5 Attendance
- FR5.1: Class teacher records daily attendance for her class; subject teachers may record per-period attendance for their subject/class slot.
- FR5.2: Attendance cannot be back-dated beyond a configurable admin-set window (default 3 days) without Admin override.
- FR5.3: Admin/Registrar view attendance analytics (per student, per class, per staff).

### 6.6 Timetable, Exam Scheduling & Invigilation
- FR6.1: Admin/Registrar can build timetable slots manually per class arm; system flags teacher/venue double-booking conflicts before save.
- FR6.2: Admin/Registrar can instead trigger **AI-assisted class timetable generation** for a class arm or the whole school: the engine assigns subjects to day/period slots subject to active `SchedulingConstraint` rules, including — by default — placing `requiresCalculation` subjects in the earliest morning periods and spreading them across the week rather than clustering them on one or two days. Triggering generation creates a `ScheduleGenerationRequest` (status `QUEUED`) and returns immediately — the solve runs **asynchronously** (ARCHITECTURE.md §9), so the requester is not left waiting on a held-open request for however long the solve takes.
- FR6.3: Super-Admin/Registrar (not Admin — §5) can trigger **AI-assisted exam timetable generation** per `AssessmentComponent` (the `EXAM`-type component for the relevant class level+term), asynchronously (same pattern as FR6.2): calculation subjects are scheduled first (earliest slots each exam day) and spread across the exam period with a minimum gap (configurable via `SchedulingConstraint`, default 1 day) between two calculation-subject exams for the same class, so students aren't hit with back-to-back demanding papers.
- FR6.4: Super-Admin/Registrar (not Admin) can trigger **AI-assisted invigilation assignment** per `ExamSchedule`, asynchronously: the engine assigns LEAD/ASSISTANT invigilators from the pool of active staff, **excluding any staff member currently holding a `BURSAR`, `PRINCIPAL`, or `VICE_PRINCIPAL` `StaffAssignment`** (per the seeded `EXCLUDED_INVIGILATION_ASSIGNMENT_TYPES` constraint), balancing load across the remaining eligible staff, preventing double-booking (no staff member invigilates two concurrent exams), and, where feasible, avoiding assigning a teacher to invigilate their own subject.
- FR6.5: All AI-generated schedules are created in `PENDING_REVIEW` status and are **not visible to staff, students, or parents** until reviewed and set to `approvalStatus = APPROVED` (in bulk or per-slot). Class timetables can be approved by Admin or Super-Admin. **Exam timetables and invigilation rosters can only be approved by Admin** — even though Registrar's exam-scheduling work reports to Super-Admin (§5), final publish approval is treated as a day-to-day operational sign-off rather than an ownership matter, so Super-Admin does not approve these. Rejected or edited slots can be regenerated individually without discarding the rest of the schedule.
- FR6.6: The system records which `SchedulingConstraint` rules and inputs were applied to a given generation run, for explainability and audit (see `AuditLog`, §7).
- FR6.7: Once approved, students/parents/staff view read-only class timetables scoped to their class/assignments. Exam schedules, once approved, are similarly visible to students/parents/staff scoped to their class. Invigilation rosters are visible to the assigned staff, Registrar, Super-Admin, and Admin (the last for its approval role, §5, footnote 4) — not to students or parents.
- FR6.8: When the solver finishes, it calls back with the result; the system marks `ScheduleGenerationRequest.status = COMPLETED`, persists the generated rows as `PENDING_REVIEW`, and notifies the requester (in-app + email) that a draft schedule is ready to review — they don't need to poll or keep the page open while it solves.
- FR6.9: If no callback arrives within a configurable timeout (default 10 minutes), a scheduled sweep marks the `ScheduleGenerationRequest` `TIMED_OUT` and notifies the requester that generation failed and can be retried — a lost or crashed solver run never leaves a request silently stuck in `QUEUED`/`SOLVING` forever.

### 6.7 Fees & Billing
- FR7.1: Super-Admin/Bursar defines `FeeStructure` per class level/term (not Admin — Bursar reports directly to Super-Admin and the entire fee/finance domain is invisible to Admin, §5).
- FR7.2: System generates `Invoice`s per student per term based on applicable fee structures (auto, or triggered as a batch job by Super-Admin/Bursar).
- FR7.3: Parent pays an invoice online via **Monnify** — hosted checkout (card, bank transfer, USSD) or a reserved/virtual account, if the school has one provisioned per student. Bursar can additionally record manual payments (cash) for offline collection.
- FR7.4: Parent views/downloads invoices and receipts for their wards only.
- FR7.5: A Monnify webhook confirms payment; the handler verifies the webhook signature before trusting the payload, resolves the `Payment`/`Invoice` directly by reference (no routing ambiguity — this deployment only ever holds one school's invoices), and is idempotent against `monnifyTransactionReference` (a retried/duplicated webhook must not create a second `Payment` row). Confirmed payment updates `Invoice.status`, generates a `Receipt`, and triggers notification (in-app + email) to the paying parent.
- FR7.6: If a Monnify webhook is missed (network failure, downtime), a scheduled reconciliation job periodically polls Monnify's transaction-status API for any `Payment` stuck in `PENDING` beyond a threshold (e.g. 15 minutes) and resolves it — payments are never left permanently unreconciled due to a lost webhook.
- FR7.7: Bursar/Super-Admin configures `PaymentGatewayConfig` (Monnify API key/secret, contract code, sandbox vs live) once for the school; credentials are encrypted at rest and never exposed to the frontend or logs.

### 6.8 Notifications
- FR8.1: WebSocket gateway authenticates connections via JWT; delivers real-time in-app notifications scoped to `recipientUserId`.
- FR8.2: Notification events are published to Redis pub/sub so any Nest instance can deliver to a connected socket regardless of which instance the socket lives on (horizontal scaling support, if this school's deployment runs more than one API instance).
- FR8.3: Every notification type has a `NotificationTemplate`; email dispatch goes through a BullMQ queue with retry (exponential backoff, max 3 attempts) via Resend.
- FR8.4: Resend delivery webhooks update `EmailLog.status` (delivered/bounced/complained); bounced parent emails flag the guardian record for Admin follow-up.
- FR8.5: Users can mark notifications read/unread; unread count exposed via API and pushed live via socket.
- FR8.6: Critical notifications (report card published, invoice overdue, password reset) cannot be disabled via `NotificationPreference`; informational ones (e.g. attendance marked) can be.

---

## 7. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Security | Argon2 password hashing; JWT RS256 or HS256 with rotated secrets; rate-limiting on auth and invitation-accept endpoints (NestJS Throttler); input validation via `class-validator` DTOs on every endpoint; parameterized queries only (ORM-enforced); isolation is by deployment — each school runs its own separate application instance and database, so there is no shared runtime or code path that could reach another school's data, by construction rather than by a filter that could be forgotten; Monnify webhook signatures are verified before any payload is trusted; `PaymentGatewayConfig` secrets are encrypted at rest via application-level envelope encryption (a single master key held in the hosting platform's secret store) rather than a paid cloud KMS or a self-hosted Vault server — kept low-cost, revisited only if secret volume/rotation needs outgrow it (§10) |
| Data integrity | Student-guardian relationship enforced transactionally + DB trigger; soft deletes for auditability on User, StudentProfile, ScoreEntry |
| Availability | Target 99.5% uptime per deployment; stateless Nest instances behind a load balancer; WebSocket sticky sessions or Redis adapter for multi-instance fanout if this deployment scales beyond one API instance |
| Performance | P95 API response < 300ms for reads; report card PDF generation offloaded to background jobs, not blocking request threads |
| Scalability | Scaling means handling more users/load within this one school's deployment (more API instances behind a load balancer, a read replica if query load warrants it) — not accommodating more schools, since each school is its own separate deployment by design. Supporting an additional school means standing up an additional independent deployment, an infrastructure activity outside the application (§2.2) |
| Auditability | `AuditLog` table capturing who changed what (score entries, fee records, role assignments) with before/after snapshots for sensitive tables |
| Observability | Structured logging (pino), request tracing correlation IDs, health check endpoints (`/health`) for DB/Redis/Resend/Monnify connectivity |
| Accessibility | Next.js frontend meets WCAG 2.1 AA for core flows (forms, tables, navigation) |
| Internationalization | English only in v1; copy externalized to allow future i18n |
| Testing | Unit tests (Jest) for services/guards; e2e tests (Supertest) for permission-boundary scenarios per role (e.g. class teacher can't see another class, parent can't see another parent's ward); contract tests for shared DTO package |

---

## 8. API & Real-Time Design Notes

- REST API versioned under `/api/v1`, resource-oriented, DTOs shared between NestJS and Next.js via a shared `packages/types` workspace package (single source of truth for request/response shapes — eliminates frontend/backend drift).
- WebSocket namespace `/notifications`, JWT handshake auth, per-user room (`user:{userId}`) — server emits `notification:new`, `notification:read`, `unreadCount:update`.
- All list endpoints (students, staff, etc.) support pagination and filtering. There is no tenant-scoping concern to reason about — this deployment's database only ever holds one school's data, so a query simply can't reach any other school's rows. Role-based scoping (e.g. class teacher → own class only) is still enforced per-request via guards/CASL, since that's a within-school concern the deployment boundary doesn't solve.

---

## 9. Milestones (Suggested Phasing)

| Phase | Scope |
|---|---|
| Phase 1 — Foundation | Application schema and migrations, standard single-connection Prisma client, invitation-based auth core (`Invitation` model, accept-invite flow, JWT), one-time deployment setup step (seeds defaults, creates the first `SUPER_ADMIN` invitation), Session/Term/Class/Department CRUD, Super-Admin (Proprietor) & Admin dashboard shell |
| Phase 2 — People | Admin invitation flow (by Super-Admin), Staff/Parent invitation flows (invite, accept, resend, revoke), Student record creation with inline parent invite, StaffAssignment, StudentGuardian enforcement, ownership transfer, role-scoped list views |
| Phase 3 — Academics | Subject management (incl. groups, department rules, calculation flag), enrollment, manual class timetable |
| Phase 4 — Assessment | Per-class-level assessment component structure (CA/Mid-Term/Exam, admin-configurable, schedule-gated with separate publish dates), score entry, aggregation, psychomotor/affective-cognitive skill ratings (session-configurable lists), scheduled class-teacher report input, subject/class-teacher/principal comments, report card generation/publishing, Academic Calendar |
| Phase 5 — Operations | Attendance, fees/billing, receipts, Monnify integration (`PaymentGatewayConfig`, hosted checkout, webhook reconciliation + polling fallback) |
| Phase 6 — Notifications & Polish | WebSocket in-app notifications, Resend email integration for all events, notification preferences, audit log, performance hardening |
| Phase 7 — AI Scheduling | AI-assisted class & exam timetable generation (constraint-based: calculation-subject morning placement, spread rules), AI-assisted invigilation assignment (excluding Bursar/Principal/VP), `SchedulingConstraint` admin configuration UI, review & approval workflow for all AI-generated schedules (class timetables: Admin/Super-Admin; exam timetables & invigilation: Admin only) |

---

## 10. Open Questions / Future Considerations

- Cross-school parents/staff: under one-application-per-school, a parent with wards in two different schools needs two entirely separate accounts (different deployments, different databases, different credentials, no shared identity or single sign-on between them). Worth surfacing clearly in onboarding UX rather than solving structurally in v1.
- Master-key custody and rotation plan for the application-level envelope encryption (where exactly the key lives, who can access it, how it's rotated) needs to be nailed down before any real `PaymentGatewayConfig` secret is stored — revisit moving to Vault/a KMS only if secret volume grows enough that manual key custody becomes the actual bottleneck, not by default.
- If the same team ends up operating many schools' deployments, is a lightweight internal tool worth building to track which schools are deployed, their versions, and their health? This is explicitly outside the product itself (§1.2) — a spreadsheet/runbook is probably sufficient at small scale, and formal tooling is only worth it once instance count makes manual tracking the actual bottleneck.
- Monnify integration model: reserved/virtual account per student (parent pays into a dedicated account number, auto-reconciled) vs. a one-time hosted checkout link generated per invoice. Recommend starting with hosted checkout (simpler, no per-student account provisioning against Monnify's API) and adding reserved accounts later if the school wants a standing "always open" payment channel per student.
- Who absorbs Monnify's transaction fee — the school (netted from the amount received) or the parent (added on top at checkout)? Needs to be a configurable setting on `PaymentGatewayConfig`, not hardcoded.
- Webhook reliability: Monnify webhooks can arrive out of order or be retried; FR7.5/FR7.6 handle this via idempotency on `monnifyTransactionReference` plus a polling fallback, but the retry/backoff policy for the reconciliation job itself needs tuning once real transaction volume is observed.
- AI scheduling engine implementation approach: a deterministic constraint-solver (e.g. OR-Tools CP-SAT) is recommended over a pure LLM-based approach for reliability and explainability, since schedules must be rule-following and auditable; an LLM may still be layered on top for natural-language constraint intake (e.g. "avoid Fridays for Physics exams") and for generating human-readable explanations of why a given slot was chosen. To be confirmed during Phase 7 technical design.
- Whether AI-generated schedule approval should support partial approval (slot-by-slot) at launch, or only whole-schedule approve/reject with manual edit-then-reapprove — affects `TimetableSlot`/`ExamSchedule`/`InvigilationAssignment` approval UX.
- Ownership transfer UX (FR1.9): should the outgoing Super-Admin automatically be demoted to `ADMIN` (recommended — preserves their access), or fully removed from the school? Also whether transfer requires the *incoming* owner to confirm/accept, or takes effect immediately on the outgoing Super-Admin's action alone.
- Native mobile app — API design (REST + WebSocket) is mobile-ready; no native client planned in v1.
- Configurable grading systems (some Nigerian schools use A1-F9 WAEC-style, others A-F) — `GradeScale` table already supports this, just needs a setup UI.

---

## 11. Success Metrics

- New school deployment time — from starting a fresh deployment to the Proprietor's first successful login — measured as an infrastructure/setup metric (§2.2), not an in-app workflow, since there's no in-app provisioning step to time.
- Invitation acceptance rate and time-to-accept for Admin/Staff/Parent invites — surfaced to Super-Admin/Admin as an onboarding health signal.
- Time for Admin to onboard a full class (students + parents) — target < 5 min per student via bulk import (CSV) by Phase 2.
- Monnify payment reconciliation latency — time from a parent completing checkout to `Invoice.status` reflecting payment — target < 30 seconds via webhook (with the polling fallback, §10, catching the rare missed-webhook case within 15 minutes).
- Report card publish-to-parent-notification latency < 2 minutes end-to-end (generation + email + in-app).
- Zero unauthorized cross-role data access incidents (verified via automated permission-boundary test suite, run in CI on every PR) — e.g. a class teacher never able to read another class's students, a parent never able to read another parent's ward.
- Class teacher / subject teacher score entry error rate (post-close corrections) tracked via `AuditLog` as a data-quality signal.
- AI-generated schedule (class timetable / exam timetable / invigilation roster) approval turnaround — target < 24 hours from generation to Admin/Super-Admin approval or edit; % of AI-generated slots accepted without manual edit, tracked as a proxy for constraint-solver quality.
