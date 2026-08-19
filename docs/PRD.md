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
| Payments | Pluggable gateway integration behind a common adapter interface (ARCHITECTURE.md §5, §10) — **Monnify** (Nigerian payment gateway) is the default, **Paystack** is also supported; which one is active is an environment-configured setting (`PAYMENT_GATEWAY_PROVIDER`), not a code change. Reserved/virtual accounts and hosted checkout (card, bank transfer, USSD) for parent fee payments, webhook-based reconciliation. Each school configures its own merchant credentials per provider; fees are never intermediated by anything outside the school's own deployment. Parents can also pay directly into the school's bank account and have the Bursar upload proof of payment for Super-Admin approval (§3.9, §6.7) |

### 2.2 Deployment Model: Single-Tenant, One Application Per School

- **Isolation by deployment, not by database row or shared-instance boundary.** Each school gets its own complete, independent deployment: its own database, its own running application (API + worker + web), its own domain. There is no shared runtime, shared database instance, or shared code path between two schools' deployments — if the product serves 10 schools, that's 10 separate installs of the same codebase, not one service juggling 10 tenants. This is the strongest form of isolation available: not "a query could theoretically leak across a boundary that's supposed to prevent it," but "there is no other school's data reachable from any given running instance, full stop."
- **No `schoolId` column anywhere, and no dynamic tenant resolution.** Because a deployment only ever holds one school's data, there's nothing to scope queries against — every table in §3 is exactly as it would be in any ordinary single-tenant application. There is no per-request "which database do I talk to" step, no tenant claim in the JWT, no request-scoped connection switching. A standard Prisma client is instantiated once at application boot from environment configuration and used for the lifetime of the process (ARCHITECTURE.md §6).
- **Provider flexibility is still preserved, just simpler.** The database connection string, storage credentials, and payment gateway credentials are all environment/database configuration, not hardcoded to a specific vendor — moving a school's database to a different Postgres host later is a config change plus a redeploy (and a one-time data migration if the old host needs decommissioning), not an application code change. There's no need for a runtime "provisioning adapter" abstraction here, because nothing in the running application ever creates a new database at runtime — that's an infrastructure action taken once, outside the app, when a school's deployment is first stood up.
- **Onboarding a new school = deploying a new, independent instance.** This is a deployment/infrastructure activity (a script, an IaC module, or a hosting platform's "new app" flow), not an in-app feature: provision a new database, set that deployment's environment configuration (DB connection, default payment gateway provider, secrets), run migrations, run the one-time setup step that seeds defaults and creates the school's first Super-Admin invitation (§6.1). There is no in-app screen for this, and no in-app role that performs it — whoever operates the infrastructure (the school itself, or a vendor/consultant setting it up on their behalf) runs this once per school.
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

Scoring structure is **configurable per class group, per term** — different class groups (e.g. Primary vs. SSS) can run different CA splits in the same term, and every class level within a group (e.g. JSS1/JSS2/JSS3) shares one structure. The system does not hardcode a 20/20/60 split; it enforces only that a class group's defined components for a term sum to 100. (Recommended default when Admin sets up a new term: one or two CA components summing to 20, one Mid-Term component of 20, one Exam component of 60 — but Admin can add/resize components freely as long as the total holds.)

- **`AssessmentComponent`** — id, termId, classLevelCategory (enum: `CRECHE`, `NURSERY`, `PRIMARY`, `JSS`, `SSS` — see `ClassLevel.category`), type (enum: `CA`, `MID_TERM`, `EXAM`), name (e.g. "1st CA", "2nd CA", "Mid-Term Test", "Terminal Exam"), sequence (int — distinguishes multiple components of the same type, e.g. CA1 vs CA2), maxScore (decimal), inputOpensAt (timestamptz), inputClosesAt (timestamptz), publishAt (timestamptz — when scores under this component become visible to students/parents, distinct from `inputClosesAt`), status (enum: `DRAFT`, `OPEN`, `CLOSED`, `PUBLISHED`), createdByUserId. Unique per (termId, classLevelCategory, type, sequence). **Created/edited by Admin only.** Status transitions automatically off the three date fields (a scheduled sweep, mirroring the pattern in ARCHITECTURE.md §9/§10) but Admin can override any transition manually (force-open, force-close, force-publish/unpublish) — same "scheduled by default, Admin override always available" shape as the old `AssessmentWindow`.
  - **Structure-completeness check**: before any component for a given (termId, classLevelCategory) can move to `OPEN`, the system validates that the full set of components defined for that pair sums to 100 — catches an incomplete setup (e.g. Exam defined but Mid-Term forgotten) before staff start entering scores against a structure that can't produce a valid total.
- **`ScoreEntry`** — id, studentId, subjectId (child subject if grouped), assessmentComponentId, classArmId, score, enteredByStaffId, enteredAt, updatedAt. Unique per (studentId, subjectId, assessmentComponentId). Write permission: only the `SUBJECT_TEACHER` assigned to that subject+classArm for the current session, and only while the component's status is `OPEN` (or Admin, as override, any time).
- **`SubjectTermResult`** — computed/materialized: sums a student's `ScoreEntry` rows across all of that term+class-level's `AssessmentComponent`s for a subject into a total (out of 100, by construction of the structure-completeness rule above), a grade letter **and remark** (both via `GradeScale` — the remark is the matched `GradeScale` row's own `remark` field, not separately entered), and position-in-class (optional). For grouped subjects, aggregates child-subject `SubjectTermResult` rows using `SubjectGroupWeight` into the parent subject's result.
- **`GradeScale`** — id, minScore, maxScore, grade (A1, B2, ... or A-F), remark, gradePoint (nullable, for GPA-style schools). **Admin/Super-Admin configures grade + remark together, per row** — a subject's (or the report's overall) remark is never entered separately; it's always whatever remark the matching `GradeScale` row for that score carries.

**Psychomotor & Affective/Cognitive Skills** (class-teacher-completed, per student per term — two separate, admin-configurable lists, not graded subjects):
- **`SkillAssessmentItem`** — id, academicSessionId, category (enum: `PSYCHOMOTOR`, `AFFECTIVE_COGNITIVE`), name (e.g. "Handwriting", "Sports/Games" under Psychomotor; "Punctuality", "Neatness", "Leadership" under Affective/Cognitive), order (int), isActive. Unique per (academicSessionId, category, name). **Admin/Super-Admin configures this list once per academic session.** When Admin first opens the config screen for a session with no items yet, the system defaults it from the most recent prior session's list (copied, not referenced — the new session gets its own editable rows); if there is no prior session with any items (first-ever session), Admin must build the list from scratch before it can be used.
- **`SkillRating`** — id, studentId, termId, skillAssessmentItemId, rating (enum: `EXCELLENT`, `VERY_GOOD`, `GOOD`, `FAIR`, `POOR`), ratedByStaffId, createdAt/updatedAt. Unique per (studentId, termId, skillAssessmentItemId). Write permission: the `CLASS_TEACHER` of the student's class only (or Admin override), and only while the relevant `ReportWindow` (below) is `OPEN`.

**Report input scheduling:**
- **`ReportWindow`** — id, termId, classLevelCategory (enum, same as `AssessmentComponent.classLevelCategory`), inputOpensAt, inputClosesAt, status (enum: `DRAFT`, `OPEN`, `CLOSED`), createdByUserId. Unique per (termId, classLevelCategory). Governs **both** `SkillRating` entry and the `CLASS_TEACHER` `ReportComment` for that term+class group — both are end-of-term class-teacher tasks and share one schedule. Same auto-transition-with-override behavior as `AssessmentComponent`. `PRINCIPAL`/`HEADTEACHER` comments are **not** window-gated — they're role-scoped only, expected to happen after the class-teacher window closes as a matter of workflow, not enforced by a date.
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

**Broadsheet (added post-Phase-4, PRD §5, FR4.11)**: the whole-class counterpart to a `TermReportCard` — one grid, every student in scope × every subject the class group is offered, instead of one PDF per student. **Super-Admin/Principal/Headteacher only** — deliberately narrower than everything else in this section; Admin does not get it. Two independent scopes, chosen at request time:

- **Class scope** — a `ClassLevel` by default (every `ClassArm` under it combined, e.g. all of "JSS 1" across two arms), or a single `classArmId` to narrow down to one arm instead.
- **Time scope** — one `Term` ("by term," each cell is that term's own `SubjectTermResult.totalScore`), or a whole `AcademicSession` ("Overall" — each cell becomes that student's *average* across whichever terms in the session actually have a result for that subject, the same missing-term-excluded rule §3.6's annual-average report-card grading already uses; a subject with zero terms scored is blank, not zero).

Both **position** (per-subject and overall) and **sorting** (by any subject column, overall average, or overall position) are computed fresh over the full requested scope at read time — never a read of `SubjectTermResult`'s own stored `position`, which is always per-`ClassArm`-per-`Term` regardless of what the broadsheet is scoped to. Ranking is always computed before pagination narrows what's actually returned, so a student's position is correct even on a later page.

**Attendance line (`FULL_TERM` only)**: the final report card shows the student's attendance as "days present / school-days-opened this term," computed the same way as §3.7's attendance analytics (`computeSchoolDaysOpened`/`computeAttendancePercentage`, `packages/types` — shared so both apps/api and the report-card generator apply the identical rule). Absent from the PDF only when there's no `AttendanceRecord` data for the student/term at all.

**Workflow:** Admin defines each class level's `AssessmentComponent`s for the term (validated to sum to 100) → components open on schedule (or Admin override) → subject teachers enter `ScoreEntry` while open → components close and later publish on schedule → aggregation job computes `SubjectTermResult` on close → in parallel, the term's `ReportWindow` opens for each class level → class teachers rate `SkillAssessmentItem`s and write their `CLASS_TEACHER` comment while it's open → window closes → subject teachers add `SUBJECT` comments, principal/headteacher adds their comment → Admin (or an automated job once all required pieces are present) triggers `TermReportCard` generation → Admin publishes → parents/students see it (published-only), scoped to what's been published per-component where partial visibility matters.

### 3.7 Attendance

- **`AttendanceSession`** — id, classArmId, date, period (nullable — null = daily attendance; set = per-period), takenByStaffId, type (STUDENT | STAFF).
- **`AttendanceRecord`** — id, attendanceSessionId, personId (studentId or staffId, polymorphic via `personType`), status (enum: PRESENT, ABSENT, LATE, EXCUSED), remark.
- Staff attendance: taken by Admin/Registrar. Student attendance: taken by subject teacher (per period) or class teacher (daily), scoped to their assignment.
- **"School-days-opened" (design decided during Phase 4, not yet built — feeds the `FULL_TERM` `TermReportCard`'s attendance line, §3.6)**: the count of "times school opened" in a term is **auto-calculated**, never manually entered, from the term's date range minus weekends minus declared public holidays. Counting granularity is **school-wide configurable**, not per-term: `DAILY` (one count per school day) or `MORNING_AND_AFTERNOON` (two counts per school day — morning and afternoon sessions counted separately, doubling both the denominator and however "present" is recorded per session). This requires a declared-holiday concept (a school closure date, scoped to an academic session or term) that doesn't exist yet either — whatever Phase 5 introduces for it (e.g. a `SchoolHoliday`/`PublicHoliday` table) must subtract from the raw weekday count before it's used as the report card's attendance denominator. A student's "days present" is the corresponding count of their own `AttendanceRecord.status = PRESENT` rows over the same period/granularity.

### 3.8 Timetable, Exam Scheduling & Invigilation

- **`TimetableSlot`** — id, classArmId, subjectId, staffId, academicSessionId, termId, dayOfWeek (enum), startTime, endTime, venue (nullable), generatedBy (enum: `MANUAL`, `AI`), approvalStatus (enum: `DRAFT`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`), approvedByUserId (nullable), approvedAt (nullable). Admin/Registrar-managed CRUD, or produced by the AI scheduling engine (§6.6) and gated behind approval before it is visible to staff/students/parents. Validated for teacher/venue double-booking conflicts at the service layer regardless of origin.
- **`ExamSchedule`** — id, assessmentComponentId (FK → `AssessmentComponent` — the `EXAM`-type component for that class level+term), classArmId, subjectId, date, startTime, endTime, venue, generatedBy, approvalStatus, approvedByUserId, approvedAt. Exam slots are generated per assessment component (e.g. the class level's "Terminal Exam" component) separately from `TimetableSlot`, since exam sequencing constraints (calculation-subject placement, spread across the exam period) differ from routine class periods.
- **`InvigilationAssignment`** — id, examScheduleId FK → `ExamSchedule`, staffId, role (enum: `LEAD`, `ASSISTANT`), generatedBy, approvalStatus, approvedByUserId, approvedAt. Eligible staff pool excludes anyone holding an active `BURSAR`, `PRINCIPAL`, or `VICE_PRINCIPAL` `StaffAssignment` (§6.6). For a `JSS`/`SSS`-scoped generation run, the solver also **hard-excludes** the specific `SUBJECT_TEACHER`(s) assigned to the exam's own subject+class arm from that exam's invigilation pool — not merely deprioritized, as in the original design; a `CRECHE`/`NURSERY`/`PRIMARY`-scoped run keeps this as a soft preference only, since that class-level group is normally taught by a single class teacher rather than per-subject teachers, so a hard exclusion there would shrink an already-small eligible pool for little benefit (§6.6 FR6.4).
- **`DutyAssignment`** — id, weekStartDate (date — the Monday of the ISO week the duty covers), classLevelCategoryGroup (enum: `JSS_SSS`, `CRECHE_NURSERY_PRIMARY` — the same Principal/Headteacher scoping split used elsewhere in this section, formalized here since a duty roster has no class/subject/exam row of its own to derive the group from), staffId, generatedBy (enum: `MANUAL`, `AI`), approvalStatus (enum: `DRAFT`, `PENDING_REVIEW`, `APPROVED`, `REJECTED`), approvedByUserId (nullable), approvedAt (nullable). One row per staff member per duty week — same per-assignment-row shape as `InvigilationAssignment` — so an individual week/staff pairing can be edited or rejected without discarding the rest of a term's rotation. Covers general weekly supervision duty (e.g. gate/assembly/break duty), a rotation distinct from exam invigilation (§6.6).
- **`SchedulingConstraint`** — id, scope (enum: `CLASS_TIMETABLE`, `EXAM_TIMETABLE`, `INVIGILATION`, `WEEKLY_DUTY`), key (e.g. `CALCULATION_SUBJECTS_MORNING`, `SPREAD_CALCULATION_SUBJECTS`, `MIN_GAP_BETWEEN_CALCULATION_EXAMS_DAYS`, `MAX_INVIGILATIONS_PER_STAFF_PER_DAY`, `EXCLUDED_INVIGILATION_ASSIGNMENT_TYPES`, `MID_TERM_MAX_SUBJECTS_PER_DAY`, `MID_TERM_CALCULATION_SUBJECT_DURATION_MINUTES`, `MID_TERM_NON_CALCULATION_SUBJECT_DURATION_MINUTES`, `TEACHERS_PER_WEEK`, `EXCLUDED_DUTY_ASSIGNMENT_TYPES`, `MIN_WEEKS_BETWEEN_REPEAT_DUTY`), value (jsonb), isActive. Lets Admin tune the AI generator's rules without a code change; seeded with sensible defaults (see §6.6) at initial setup, including `EXCLUDED_INVIGILATION_ASSIGNMENT_TYPES = [BURSAR, PRINCIPAL, VICE_PRINCIPAL]` and `EXCLUDED_DUTY_ASSIGNMENT_TYPES = [BURSAR, PRINCIPAL, VICE_PRINCIPAL]` (same default pool exclusion, independently tunable per scope).
- **`ScheduleGenerationRequest`** — id, scope (enum: `CLASS_TIMETABLE`, `EXAM_TIMETABLE`, `INVIGILATION`, `WEEKLY_DUTY`), classArmId (nullable, for class-timetable scope), assessmentWindowId (nullable, for exam/invigilation scope), termId (nullable, for weekly-duty scope — a duty run generates a full term's week-by-week rotation in one solve, not one week at a time), classLevelCategoryGroup (nullable enum, same `JSS_SSS`/`CRECHE_NURSERY_PRIMARY` values as `DutyAssignment` — set for weekly-duty scope, derived from the triggering Principal/Headteacher/Super-Admin/Registrar's own scope the same way the other scopes already derive theirs from `classArmId`/`assessmentWindowId`), parameters (jsonb, nullable — run-specific overrides layered on top of the stored `SchedulingConstraint` defaults for this run only, without requiring an Admin settings change for a one-off generation; e.g. `{ teachersPerWeek: 3 }` for a `WEEKLY_DUTY` run, or `{ maxSubjectsPerDay: 2, calculationSubjectDurationMinutes: 90, nonCalculationSubjectDurationMinutes: 60 }` for a `MID_TERM` `EXAM_TIMETABLE` run — see FR6.3a/FR6.11), status (enum: `QUEUED`, `SOLVING`, `COMPLETED`, `FAILED`, `TIMED_OUT`), requestedByUserId, requestedAt, completedAt (nullable), errorMessage (nullable). Tracks an **in-flight** AI generation run — the solver call is asynchronous (§6.6, ARCHITECTURE.md §9), so this row is what exists *before* any `TimetableSlot`/`ExamSchedule`/`InvigilationAssignment`/`DutyAssignment` rows are written, and is what a scheduled timeout sweep checks to catch a run that never got a callback.

### 3.9 Fees & Billing

- **`FeeStructure`** — id, classLevelId (nullable — can apply to a level or school-wide), academicSessionId, termId, name (e.g. "Tuition", "PTA Levy"), amount, isMandatory.
- **`Invoice`** — id, studentId, termId, totalAmount, status (unpaid/partial/paid/overdue), dueDate, generatedAt, gatewayPaymentReference (nullable — the active gateway's reference for this invoice's checkout, generated at invoice time; unique per invoice, e.g. `INV-{invoiceId}-{timestamp}` — no cross-deployment ambiguity to resolve, since a webhook to this deployment can only ever mean this school; the field name is provider-agnostic since a school can move between gateways over its lifetime without a schema change). **Outstanding balance** (`totalAmount` minus any approved `DiscountRequest` reduction, minus the sum of that invoice's `SUCCESSFUL` `Payment` rows) is *computed*, not a stored column — same reasoning as the Academic Calendar (§3.11): deriving it from `Payment`/`DiscountRequest` avoids a second source of truth that can drift. `Invoice.status` (unpaid/partial/paid/overdue) is kept as a stored, indexed field for list-filtering performance, but is always recomputed from the same underlying rows whenever a `Payment` or `DiscountRequest` changes state — never hand-set independently. The `overdue` transition can also happen with no `Payment`/`DiscountRequest` event at all (a due date simply passing) — an hourly worker sweep (ARCHITECTURE §8, `invoice-overdue-sweep`) catches that case using the identical recompute formula, flips the stored status, and notifies every guardian (`INVOICE_OVERDUE`, FR8.6).
- **`InvoiceLineItem`** — id, invoiceId, feeStructureId (nullable — null for a discount line), type (enum: `FEE`, `DISCOUNT`), amount (negative for `DISCOUNT` lines), description.
- **`Payment`** — id, invoiceId, amount, paidByUserId (parent, nullable for staff-recorded entries), method (enum: `GATEWAY_CARD`, `GATEWAY_TRANSFER`, `GATEWAY_USSD`, `GATEWAY_RESERVED_ACCOUNT`, `BANK_TRANSFER_MANUAL`, `CASH`), gatewayProvider (nullable enum: `MONNIFY`, `PAYSTACK` — set only for `GATEWAY_*` methods; recorded per-payment rather than read from the current `PaymentGatewayConfig` default, so a payment's history stays accurate even after the school later switches its active provider), gatewayTransactionReference (nullable — the gateway's own transaction ID, used for idempotency/reconciliation), status (enum: `PENDING` — gateway checkout started, awaiting webhook/poll; `PENDING_APPROVAL` — manual bank-transfer submission awaiting Super-Admin review; `SUCCESSFUL`; `FAILED`; `REVERSED`; `REJECTED` — manual submission rejected by Super-Admin), paidAt, recordedByStaffId (nullable — Bursar, for `CASH` or `BANK_TRANSFER_MANUAL` entries), proofOfPaymentUrl (nullable — Bursar-uploaded receipt/screenshot for `BANK_TRANSFER_MANUAL`, via `StorageAdapter`), reviewedByUserId (nullable — Super-Admin, set when a `BANK_TRANSFER_MANUAL` submission is approved/rejected), reviewedAt (nullable), rejectionReason (nullable, required when status is set to `REJECTED`).
  - `CASH` is recorded by the Bursar and takes effect immediately (`SUCCESSFUL`) — the Bursar witnessed the payment directly, same trust level as today.
  - `BANK_TRANSFER_MANUAL` covers a parent paying directly into the school's bank account and sending proof to the Bursar (§6.7 FR7.3a): the Bursar was not present for the transfer, so it starts `PENDING_APPROVAL` and requires Super-Admin sign-off before it counts toward the invoice — see the workflow in ARCHITECTURE.md §10.
- **`Receipt`** — id, paymentId, receiptNumber (unique), pdfUrl, issuedAt. Generated uniformly the moment a `Payment` reaches `SUCCESSFUL`, regardless of which path got it there (gateway webhook, reconciliation poll, or manual-payment approval) — this is the parent-facing "online receipt" (§6.7 FR7.4a).
- **`PaymentGatewayConfig`** — **one row per provider** (`MONNIFY`, `PAYSTACK`, ...; unique on `provider`, an ordinary unique constraint — not the partial-unique-index singleton pattern used for `SUPER_ADMIN`/current `AcademicSession`, because more than one provider's credentials can be configured and stored at once now) — id, provider, apiKey (encrypted at rest, application-layer envelope encryption), secretKey (encrypted at rest), contractCode (Monnify-specific; nullable, provider-specific fields like this are expected to differ per row), reservedAccountEnabled (boolean, Monnify-specific), environment (enum: `SANDBOX`, `LIVE`), isActive (boolean — "this row's credentials are configured and usable," not "this is the chosen default"). Configured by Super-Admin/Bursar during fee module setup — the school pays into its **own** merchant wallet for whichever provider is active; nothing outside this deployment ever touches or intermediates the school's fee money. **Which provider is used for new checkouts is decided by the `PAYMENT_GATEWAY_PROVIDER` environment variable (default `MONNIFY`), read once at boot** — not a database flag — so switching a school's default gateway is a config change plus a redeploy (matching the philosophy already established for storage/database provider choice, ARCHITECTURE.md §2.2), and a school can keep a second provider's credentials configured and ready for a fast cutover without re-entering secrets.
- **`DiscountRequest`** — id, invoiceId, requestedByStaffId (Bursar), type (enum: `PERCENTAGE`, `FIXED_AMOUNT`), value (numeric), reason (text), status (enum: `PENDING`, `APPROVED`, `REJECTED`), reviewedByUserId (nullable — Super-Admin only), reviewedAt (nullable), rejectionReason (nullable), createdAt. Scoped to a single `Invoice`, which is itself already scoped to one term — this is what makes discounting "termly" (§6.7 FR7.8) without needing a separate term-level concept: a new discount request is raised per term because a new `Invoice` exists per term. On `APPROVED`, the system adds a `DISCOUNT`-type `InvoiceLineItem` (negative amount) to the invoice and recomputes its outstanding balance/status; a `REJECTED` request has no effect on the invoice.
- Bursar (`StaffAssignment.assignmentType = BURSAR`) has write access to `FeeStructure`, `Invoice`, `Payment` (including submitting `BANK_TRANSFER_MANUAL` proof and recording `CASH`), `DiscountRequest` (create only), `PaymentGatewayConfig`. Only Super-Admin can review/approve/reject `Payment.status = PENDING_APPROVAL` submissions and `DiscountRequest`s — consistent with Bursar reporting directly to Super-Admin (§5 footnote 3). Parents have read access + payment initiation (via the active gateway's checkout, or by arranging a direct bank transfer and awaiting Bursar/Super-Admin confirmation) for their own wards' invoices only, plus full historical access to their own wards' invoices/receipts (§6.7 FR7.4).

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
StaffProfile 1—* DutyAssignment
StudentProfile 1—* Invoice 1—* Payment 1—1 Receipt
Invoice 1—* DiscountRequest
PaymentGatewayConfig (one row per provider, e.g. MONNIFY / PAYSTACK)
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
| Publish report cards | ✅ | ✅ | ❌ (unless also Principal or Headteacher⁵) | ❌ (unless also Principal or Headteacher⁵) | ❌ | ❌ | ❌ |
| View report cards | ✅ (all) | ✅ (all) | ✅ (own class) | ✅ (own subject entries) | ❌ | ✅ (own wards, published only) | ✅ (self, published only) |
| View broadsheet (whole-class grade grid)⁷ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View/manage academic & exam records (entire school)³ | ✅ | ❌ | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Manage fee structure / invoices³ | ✅ | ❌ | ❌ | ❌ | ✅ (Bursar) | ❌ | ❌ |
| Configure payment gateway credentials³ | ✅ | ❌ | ❌ | ❌ | ✅ (Bursar) | ❌ | ❌ |
| Make/view payments³ | ✅ (view) | ❌ | ❌ | ❌ | ✅ (record cash, submit bank-transfer proof) | ✅ (pay/view own wards) | ❌ |
| Approve/reject manual bank-transfer payment³ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Request fee discount (per invoice/term)³ | ❌ | ❌ | ❌ | ❌ | ✅ (Bursar) | ❌ | ❌ |
| Approve/reject discount request³ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View own/ward payment & receipt history³ | ✅ (school-wide) | ❌ | ❌ | ❌ | ✅ (school-wide) | ✅ (own wards) | ❌ |
| Take attendance | ✅ (all) | ✅ (all) | ✅ (own class, daily) | ✅ (own class/subject, per-period) | ✅ (staff attendance, Registrar) | ❌ | ❌ |
| View whole-school class timetable, by day or by class⁶ | ✅ | ✅ | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Manage class timetable (manual) | ✅ | ✅ | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Manage exam schedule (manual)³ | ✅ | ❌ (unless also Principal or Headteacher⁵) | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Trigger AI class timetable generation⁵ | ✅ | ❌ (unless also Principal or Headteacher⁵) | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Trigger AI exam timetable & invigilation generation³ ⁵ | ✅ | ❌ (unless also Principal or Headteacher⁵) | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Approve/publish AI-generated class timetables⁴ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve/publish AI-generated exam schedules & invigilation rosters⁴ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Eligible for invigilation duty | ❌² | ✅ (unless also Principal/VP) | ✅ | ✅ | ❌ (Bursar excluded by rule) | ❌ | ❌ |
| Trigger AI weekly duty roster generation⁵ | ✅ | ❌ (unless also Principal or Headteacher⁵) | ❌ | ❌ | ✅ (Registrar) | ❌ | ❌ |
| Approve/publish AI-generated weekly duty rosters⁴ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Eligible for weekly duty | ❌² | ✅ (unless also Principal/VP) | ✅ | ✅ | ❌ (Bursar excluded by rule) | ❌ | ❌ |

¹ Owner-only capabilities — exclusive to Super-Admin even though Super-Admin otherwise has every Admin permission plus these. Admin does not gain them even as an "Admin+" superset.

² A Super-Admin/Proprietor isn't necessarily a teaching or non-teaching staff member (no guaranteed `StaffAssignment`), so invigilation duty doesn't apply by default; if a Proprietor is also separately registered as Staff, ordinary staff eligibility rules apply to that assignment.

³ Bursar and Registrar report directly to Super-Admin (Proprietor), not to Admin — Admin has no visibility into fee/finance data or the broader academic/exam records domain those two roles manage. This mirrors real-world reporting lines where these two functions bypass the principal's office and report straight to the owner. Admin retains full authority over everything else, including class (non-exam) timetabling and day-to-day academics.

⁴ Final approval/publish of any AI-generated schedule — class timetable, exam schedule, invigilation roster, or weekly duty roster — is **Super-Admin only**, across all four scopes (revised from the original design, which split class-timetable approval to Admin-or-Super-Admin and the other three to Admin-only). Admin, and any staff member holding an active `PRINCIPAL` or `HEADTEACHER` assignment, can generate and manually edit a draft of any of the four (§5, footnote 5's scoping for triggering AI generation still applies; manual edits to an existing draft are not scoped the same way — see FR6.5), but final publish is reserved for the owner as a deliberate sign-off step, not delegated even to Admin.

⁵ Triggering (or manually editing) class-timetable, exam-timetable, invigilation, or weekly-duty-roster generation is gated by `StaffAssignment.assignmentType`, not Role alone — a Role=ADMIN user can only do these if they also hold an active `PRINCIPAL` assignment (scoped to `JSS`/`SSS` `ClassLevel.category` arms only) or `HEADTEACHER` assignment (scoped to `CRECHE`/`NURSERY`/`PRIMARY` arms only); an Admin holding neither title cannot trigger or manually edit generation at all. Super-Admin and Registrar are unscoped and may act across any level, including the whole school in one run. A Principal- or Headteacher-triggered generation run always covers every class arm within their scope at once, never a single arm in isolation — since subject teachers frequently teach across multiple arms/levels, a partial-scope solve could produce conflicts the solve never saw and therefore can't avoid.

⁶ Unlike triggering generation (footnote 5), the whole-school timetable overview is available to Admin generally — not gated behind holding a Principal/Headteacher title. However, a user whose active `StaffAssignment` includes `PRINCIPAL` sees only `JSS`/`SSS` class arms in this view, and `HEADTEACHER` sees only `CRECHE`/`NURSERY`/`PRIMARY` arms — narrower than the unscoped view a plain Admin (holding neither title), Super-Admin, or Registrar gets. Defaults to a **by-day** view (Monday–Friday, every in-scope class's periods for that day, side by side) with a toggle to a **by-class** view (one selected class's full week). This is distinct from FR6.7's read-only per-user view (a student/parent/staff member's own class/assignments only) — this is the multi-class administrative overview.

⁷ The one capability in this table that isn't "Super-Admin plus a subset for Admin" — the Broadsheet's table cell says ❌ for every role column above, but a STAFF user whose active `StaffAssignment` includes `PRINCIPAL` or `HEADTEACHER` can view it too (same "covers both StaffAssignment types" precedent as the `ReportComment.PRINCIPAL` comment type, §3.6), granted directly rather than through a table column since neither title has its own column here. Admin — unlike almost everywhere else in this matrix — does not get it at all, not even scoped.

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
- FR4.11 (added post-Phase-4): Super-Admin or a staff member holding an active `PRINCIPAL`/`HEADTEACHER` assignment (not plain Admin, §5) can view a **broadsheet** — every student in scope × every subject the class group is offered, one grid. Scoped to a `ClassLevel` by default (every arm combined) or a single `ClassArm`; and to one `Term` or a whole `AcademicSession` ("Overall," each cell averaged across whichever terms actually have a result, missing terms excluded rather than treated as zero — same rule as the annual-average report card grading in §3.6). Sortable by any subject, overall average, or overall position, and paginated — both computed server-side, with position always ranked over the full scope before any page is sliced out of it.

### 6.5 Attendance
- FR5.1: Class teacher records daily attendance for her class; subject teachers may record per-period attendance for their subject/class slot.
- FR5.2: Attendance cannot be back-dated beyond a configurable admin-set window (default 3 days) without Admin override.
- FR5.3: Admin/Registrar view attendance analytics (per student, per class, per staff).

### 6.6 Timetable, Exam Scheduling & Invigilation
- FR6.1: Admin/Registrar can build timetable slots manually per class arm; system flags teacher/venue double-booking conflicts before save.
- FR6.2: Super-Admin, Registrar, or a staff member holding an active `PRINCIPAL` or `HEADTEACHER` `StaffAssignment` (not Admin generally — §5, footnote 5) can trigger **AI-assisted class timetable generation**. Super-Admin and Registrar are unscoped and can generate for the whole school in one run, or narrow a run to a single `classLevelCategoryGroup` (`JSS_SSS`/`CRECHE_NURSERY_PRIMARY`) — same "combined or either alone" choice as FR6.11 — e.g. to retry just one group after the other already succeeded; Principal is scoped to `JSS`/`SSS` class arms only, Headteacher to `CRECHE`/`NURSERY`/`PRIMARY` arms only. A generation run always covers every class arm within its target scope at once — never a single arm in isolation — so a subject teacher who teaches across multiple arms/levels doesn't end up with conflicting slots the solve never saw together. The engine assigns subjects to day/period slots subject to active `SchedulingConstraint` rules, including — by default — placing `requiresCalculation` subjects in the earliest morning periods and, independently, capping each individual subject to at most one period/day (which is what spreads it across the week — there is no additional rule capping how many *different* calculation subjects a class arm can be taught in one day, since a level like SSS routinely carries five calculation-heavy subjects at once and a school week only has five days to spread across). Triggering generation creates a `ScheduleGenerationRequest` (status `QUEUED`) and returns immediately — the solve runs **asynchronously** (ARCHITECTURE.md §9), so the requester is not left waiting on a held-open request for however long the solve takes.
- FR6.3: Super-Admin, Registrar, or a staff member holding an active `PRINCIPAL` or `HEADTEACHER` `StaffAssignment` (not Admin generally — §5, footnote 5) can trigger **AI-assisted exam timetable generation** per `AssessmentComponent` — either the `EXAM`-type component (the full terminal exam) or the `MID_TERM`-type component, for the relevant class level+term — asynchronously (same pattern as FR6.2). Super-Admin and Registrar are unscoped; Principal may only trigger this for a `JSS`/`SSS` `AssessmentComponent`, Headteacher only for `CRECHE`/`NURSERY`/`PRIMARY`. Calculation subjects are scheduled first (earliest slots each exam day) and spread across the exam period with a minimum gap (configurable via `SchedulingConstraint`, default 1 day) between two calculation-subject exams for the same class, so students aren't hit with back-to-back demanding papers.
- FR6.3a (`MID_TERM` only): a mid-term test is normally shorter and lighter than the terminal exam, so — in addition to FR6.3's calculation-subject placement/spread rules, which still apply — the triggering user supplies run-specific parameters at generation time: **maximum subjects examined per day**, and **duration per subject** split into a calculation-subject duration and a non-calculation-subject duration (per `Subject.requiresCalculation`, §3.3), since calculation papers typically need more time than non-calculation ones. These are passed as `ScheduleGenerationRequest.parameters` (§3.8), defaulting to the school's stored `SchedulingConstraint` values (`MID_TERM_MAX_SUBJECTS_PER_DAY`, `MID_TERM_CALCULATION_SUBJECT_DURATION_MINUTES`, `MID_TERM_NON_CALCULATION_SUBJECT_DURATION_MINUTES`) when not overridden for that run. Each generated slot's `ExamSchedule.startTime`/`endTime` is derived directly from whichever duration applies to that slot's subject.
- FR6.4: Super-Admin, Registrar, or a staff member holding an active `PRINCIPAL` or `HEADTEACHER` `StaffAssignment` (not Admin generally) can trigger **AI-assisted invigilation assignment** per `ExamSchedule`, asynchronously — scoped the same way as FR6.3 (Principal to `JSS`/`SSS`, Headteacher to `CRECHE`/`NURSERY`/`PRIMARY`, Super-Admin/Registrar unscoped): the engine assigns LEAD/ASSISTANT invigilators from the pool of active staff, **excluding any staff member currently holding a `BURSAR`, `PRINCIPAL`, or `VICE_PRINCIPAL` `StaffAssignment`** (per the seeded `EXCLUDED_INVIGILATION_ASSIGNMENT_TYPES` constraint), balancing load across the remaining eligible staff, preventing double-booking (no staff member invigilates two concurrent exams), and avoiding assigning a teacher to invigilate their own subject — **hard-excluded** (not merely deprioritized) for `JSS`/`SSS`-scoped runs, kept as a best-effort preference for `CRECHE`/`NURSERY`/`PRIMARY`-scoped runs (§3.8's `InvigilationAssignment`).
- FR6.5: All AI-generated schedules are created in `PENDING_REVIEW` status and are **not visible to staff, students, or parents** until reviewed and set to `approvalStatus = APPROVED` (in bulk or per-slot). Admin, and any staff member holding an active `PRINCIPAL` or `HEADTEACHER` assignment, or Registrar, can view and manually edit a draft of any of the four schedule types (class timetable, exam timetable, invigilation roster, weekly duty roster) while it's `PENDING_REVIEW`. **Final approval — across all four — is Super-Admin only** (§5, footnote 4); Admin cannot approve even though it can generate and edit. Rejected or edited slots can be regenerated individually without discarding the rest of the schedule.
- FR6.6: The system records which `SchedulingConstraint` rules and inputs were applied to a given generation run, for explainability and audit (see `AuditLog`, §7).
- FR6.7: Once approved, students/parents/staff view read-only class timetables scoped to their class/assignments. Exam schedules, once approved, are similarly visible to students/parents/staff scoped to their class. Invigilation rosters are visible to the assigned staff, Registrar, Super-Admin, and Admin (the last for its generate/edit role, not an approval role — §5, footnote 4) — not to students or parents.
- FR6.8: When the solver finishes, it calls back with the result; the system marks `ScheduleGenerationRequest.status = COMPLETED`, persists the generated rows as `PENDING_REVIEW`, and notifies the requester (in-app + email) that a draft schedule is ready to review — they don't need to poll or keep the page open while it solves.
- FR6.9: If no callback arrives within a configurable timeout (default 10 minutes), a scheduled sweep marks the `ScheduleGenerationRequest` `TIMED_OUT` and notifies the requester that generation failed and can be retried — a lost or crashed solver run never leaves a request silently stuck in `QUEUED`/`SOLVING` forever.
- FR6.10: Super-Admin, Admin, Registrar, and any staff member holding an active `PRINCIPAL` or `HEADTEACHER` `StaffAssignment` get a whole-school class timetable overview (§5, footnote 6) — not the single-class view FR6.7 gives students/parents/staff. It defaults to a **by-day** grouping (Monday–Friday side by side, every in-scope class arm's periods for that day) with a toggle to a **by-class** grouping (one selected class arm's full week, day-by-period grid). Super-Admin/Admin/Registrar see every class arm school-wide; Principal is scoped to `JSS`/`SSS` arms only, Headteacher to `CRECHE`/`NURSERY`/`PRIMARY` arms only. Covers both the currently-published timetable and, for roles who can also approve or edit (§5), a `PENDING_REVIEW` draft under review.
- FR6.11: Super-Admin, Registrar, or a staff member holding an active `PRINCIPAL` or `HEADTEACHER` `StaffAssignment` (not Admin generally — §5, footnote 5) can trigger **AI-assisted weekly duty roster generation** for a `Term`, asynchronously (same pattern as FR6.2–FR6.4). Super-Admin and Registrar are unscoped and may generate one combined run covering both the `JSS_SSS` and `CRECHE_NURSERY_PRIMARY` groups or either alone; Principal is scoped to `JSS_SSS` only, Headteacher to `CRECHE_NURSERY_PRIMARY` only. The triggering user specifies **how many teachers should be on duty each week** (`ScheduleGenerationRequest.parameters.teachersPerWeek`, defaulting to the stored `SchedulingConstraint` value `TEACHERS_PER_WEEK` for that group when omitted). The engine produces one `DutyAssignment` row per staff member per week across every week of the term, drawing from that group's eligible teaching staff (active `CLASS_TEACHER`/`SUBJECT_TEACHER` `StaffAssignment` within the group, minus any type listed in `EXCLUDED_DUTY_ASSIGNMENT_TYPES`), rotating fairly so no staff member repeats within `MIN_WEEKS_BETWEEN_REPEAT_DUTY` weeks of their last duty turn unless the eligible pool is too small to avoid it.
- FR6.12: Weekly duty rosters follow the same review lifecycle as exam timetables/invigilation — generated in `PENDING_REVIEW`, **approved by Super-Admin only** (§5, footnote 4), not visible to the assigned staff until approved. Once approved, an assigned staff member sees their own upcoming duty weeks; Super-Admin, Admin, Registrar, and the scoped Principal/Headteacher see the full roster for their group.

### 6.7 Fees & Billing
- FR7.1: Super-Admin/Bursar defines `FeeStructure` per class level/term (not Admin — Bursar reports directly to Super-Admin and the entire fee/finance domain is invisible to Admin, §5).
- FR7.2: System generates `Invoice`s per student per term based on applicable fee structures (auto, or triggered as a batch job by Super-Admin/Bursar).
- FR7.3: Parent pays an invoice online via the school's **active payment gateway** — hosted checkout (card, bank transfer, USSD) or a reserved/virtual account, if the school has one provisioned per student. The active gateway is **Monnify by default**, selected via the `PAYMENT_GATEWAY_PROVIDER` environment variable; **Paystack** is also supported behind the same integration, so a school can switch its default gateway with a config change and redeploy rather than an application change (ARCHITECTURE.md §5, §10). Bursar can additionally record manual `CASH` payments for offline collection, which take effect immediately.
- FR7.3a: A parent may instead pay directly into the school's own bank account outside the platform and send proof of payment to the Bursar. The Bursar uploads that proof (image/PDF) against the invoice, creating a `Payment` with `method = BANK_TRANSFER_MANUAL` and `status = PENDING_APPROVAL` (§3.9). It does **not** count toward the invoice's outstanding balance until reviewed.
- FR7.3b: Only **Super-Admin** can review a `PENDING_APPROVAL` manual payment — approving it (`status = SUCCESSFUL`, generates a `Receipt`, updates the invoice, notifies both the submitting Bursar and the paying parent) or rejecting it (`status = REJECTED` with a required reason, notifies the submitting Bursar only). This mirrors the existing rule that Bursar-domain approvals of this kind sit with Super-Admin, not Admin (§5 footnote 3).
- FR7.4: Parent views/downloads invoices and receipts for their wards only, including full **historical** payment records (every past `Payment`/`Receipt`, regardless of method or gateway). Bursar and Super-Admin have the equivalent school-wide historical view across all students — a payment ledger, not just the current term's activity.
- FR7.4a: Once a `Payment` reaches `SUCCESSFUL` — via gateway webhook, reconciliation poll, or manual-payment approval — an online `Receipt` (unique receipt number + PDF) is generated the same way regardless of path, and is immediately viewable/downloadable by the paying parent.
- FR7.5: A payment gateway webhook confirms payment; the handler verifies the webhook signature (per the active provider's own verification scheme) before trusting the payload, resolves the `Payment`/`Invoice` directly by reference (no routing ambiguity — this deployment only ever holds one school's invoices), and is idempotent against `gatewayTransactionReference` (a retried/duplicated webhook must not create a second `Payment` row). Confirmed payment updates the invoice's outstanding balance/status, generates a `Receipt`, and triggers notification (in-app + email) to the paying parent.
- FR7.6: If a gateway webhook is missed (network failure, downtime), a scheduled reconciliation job periodically polls the active gateway's transaction-status API for any `Payment` stuck in `PENDING` beyond a threshold (e.g. 15 minutes) and resolves it — payments are never left permanently unreconciled due to a lost webhook. Manual `BANK_TRANSFER_MANUAL` submissions are excluded from this job — they resolve only via explicit Super-Admin review (FR7.3b), not polling.
- FR7.7: Bursar/Super-Admin configures `PaymentGatewayConfig` (API key/secret, contract code, sandbox vs live) **per provider** — a school can have both Monnify and Paystack credentials configured at once, with `PAYMENT_GATEWAY_PROVIDER` deciding which is actually used for new checkouts (§3.9). Credentials are encrypted at rest and never exposed to the frontend or logs, for every configured provider.
- FR7.8: Bursar can raise a `DiscountRequest` (percentage or fixed amount, with a reason) against a specific student's invoice; because an invoice is already scoped to one term, this is inherently a termly request — a new term means a new invoice means a fresh discount request if wanted. Only **Super-Admin** can approve or reject it (§5 footnote 3); approval applies the discount as a negative `InvoiceLineItem` and recomputes the invoice's outstanding balance, rejection leaves the invoice unchanged and notifies the requesting Bursar with the reason.
- FR7.9: A student's/invoice's **outstanding balance** (amount still owed after successful payments and any approved discount) is always visible to the parent, Bursar, and Super-Admin — computed live from `Invoice.totalAmount`, `SUCCESSFUL` `Payment`s, and approved `DiscountRequest`s (§3.9), never a value that can silently drift out of sync with the underlying records.

### 6.8 Notifications
- FR8.1: WebSocket gateway authenticates connections via JWT; delivers real-time in-app notifications scoped to `recipientUserId`.
- FR8.2: Notification events are published to Redis pub/sub so any Nest instance can deliver to a connected socket regardless of which instance the socket lives on (horizontal scaling support, if this school's deployment runs more than one API instance).
- FR8.3: Every notification type has a `NotificationTemplate`; email dispatch goes through a BullMQ queue with retry (exponential backoff, max 3 attempts) via Resend.
- FR8.4: Resend delivery webhooks update `EmailLog.status` (delivered/bounced/complained); bounced parent emails flag the guardian record for Admin follow-up.
- FR8.5: Users can mark notifications read/unread; unread count exposed via API and pushed live via socket.
- FR8.6: Critical notifications (report card published, invoice overdue, password reset) cannot be disabled via `NotificationPreference`; informational ones (e.g. attendance marked) can be.

### 6.9 Dashboards

- FR9.1: Each role's dashboard surfaces only the stats that role's permissions already cover per §5 — the dashboard is a summary view onto data the role can access elsewhere, not a separate visibility grant. In particular, **Admin's dashboard carries no finance/fee data anywhere** (outstanding balances, invoices, payments, discount requests) — that stays Bursar/Super-Admin only, per §5 footnote 3.
- FR9.2: Presentation format is chosen per stat, not uniformly per role, using this general pattern: single trending/headline numbers → stat cards; time-based or open-ended windows → countdown badges or progress bars; row-by-row scan-and-act data → tables; inherently day/time-structured data (timetables) → grids (matching the by-day/by-class overview pattern from §5 footnote 6); composition-of-a-whole numbers (paid vs. unpaid, gender split) → donut/bar charts; genuine trend-over-time data (attendance history, invitation acceptance rate) → line charts, reserved for actual trends since most counts are single-point-in-time and don't need one.
- FR9.3: Where a stat depends on cached/precomputed data rather than a live query (e.g. Principal/Headteacher's broadsheet snapshot, FR9.4), the widget shows a "last updated" timestamp rather than implying it's live.

The tables below specify format and rationale per stat, by role. Roles/titles match §5's Roles & Permissions Matrix and §3.4's `StaffAssignment.assignmentType` values.

**FR9.4 — Super-Admin**

| Stat | Format | Why |
|---|---|---|
| Outstanding fees school-wide | Stat card (large number + trend arrow vs. last term) | Single headline KPI |
| Payment reconciliation queue | Stat card with count, links to list on click | Actionable count, not detail-heavy |
| Discount requests pending | List (requester, student, amount, reason) | Needs enough detail to act, but low volume |
| Invitation acceptance rate/time | Small bar or line chart (by role: Admin/Staff/Parent) | Trend over time matters more than one number |
| Pending schedule approvals | Grid of cards (one per schedule type: class/exam/invigilation/duty) with count + "Review" CTA | Distinct categories, each needing its own entry point |
| Ownership/Super-Admin status | Inline text/badge, not a widget | Rarely changes, low visual weight needed |
| Total students/staff/parents | 3 stat cards side by side | Classic headline-metric row |
| Audit log highlights | Table (timestamp, actor, action, entity) | Structured, scannable, sortable |
| Report card publish % | Progress bar / gauge per class or school-wide | % completion is exactly what a progress bar communicates |

**FR9.5 — Admin**

*No finance/fee data anywhere on this dashboard — Bursar/Super-Admin only, per FR9.1.*

| Stat | Format | Why |
|---|---|---|
| Total enrolled students (by level/dept) | Stacked bar chart or donut | Composition across categories |
| Staff headcount + unfilled assignments | Stat card + list of gaps (e.g. "JSS2B: no class teacher") | Count up top, actionable list below |
| Assessment window status | List/table (component, class level, close date, countdown) | Multiple concurrent windows across class levels |
| Score entry completion | Table with progress bars per row (class × subject) | Grid of completion %, best as inline bars in a table |
| Report card readiness | Checklist/progress table per class (4 required pieces, checkmarks) | Binary readiness per item — checklist reads faster than %s |
| Pending schedule approvals/edits | Card grid, same pattern as Super-Admin's (view-only distinction noted) | Consistency with Super-Admin view |
| Attendance anomalies | List, sorted worst-first (class, % today, delta) | Exception-based, ranked list is the point |
| Invitation pipeline | Table (name, role, sent date, status, expires) | Needs per-row action (resend/revoke) |
| Bounced parent emails | List with "flagged" tag | Small, action-oriented |

**FR9.6 — Staff, teaching (base, all `assignmentType`s)**

| Stat | Format | Why |
|---|---|---|
| My classes/subjects this term | List or small card grid | Small, fixed set per teacher |
| Assessment components open | List with countdown badges | Time-sensitive, few items |
| Score entry progress | Table (student rows) or progress bar per class+subject if summarized | Detail table if entering scores here; summary bar if just a status check |
| Upcoming timetable | Weekly grid (day × period) | Inherently a grid — matches the by-class view used elsewhere in the product |
| Attendance to mark today | List (class roster with present/absent toggle) | Needs per-student input, not just display |

*`CLASS_TEACHER` additions:*

| Stat | Format | Why |
|---|---|---|
| Class roster (headcount, gender split) | Stat card + small donut for gender split | Quick composition view |
| Skill/report window progress | Progress bar (students rated / total) | Single completion metric |
| Comments outstanding | List of student names missing a comment | Actionable, low volume |
| Class attendance summary | Line chart (daily % over the term) | Trend over time |

*`PRINCIPAL`/`HEADTEACHER` additions:*

| Stat | Format | Why |
|---|---|---|
| Broadsheet snapshot (cached, last-viewed) | Compact table (top 5 / bottom 5 students, subject avg columns) with "last updated" timestamp + "View full broadsheet" link | Shows cached data plainly rather than implying it's live (FR9.3) |
| Schedule generation/approval queue (scoped per §5 footnote 5) | Card grid, same as Admin's | Consistency |
| Duty roster upcoming | List (week, date range) | Simple chronological list |

*`REGISTRAR` additions:*

| Stat | Format | Why |
|---|---|---|
| Whole-school attendance analytics | Bar chart by class + trend line over term | Comparison + trend together |
| Timetable overview | Grid (by-day or by-class toggle, §5 footnote 6) | Matches product's existing overview pattern |
| Schedule generation triggers | Button row / action cards | Action, not data display |

**FR9.7 — Staff, non-teaching (`BURSAR`)**

| Stat | Format | Why |
|---|---|---|
| Outstanding balance (school-wide/by class) | Stat card + bar chart by class | Headline number + where the gap concentrates |
| Invoices generated vs. paid | Donut or stacked bar (paid/partial/unpaid) | Composition of one whole |
| Pending manual payments submitted | Table (student, amount, submitted date, status) | Needs status tracking per row |
| Discount requests raised | Table (student, amount, status, date) | Status-tracked list |
| Gateway reconciliation health | Stat card (count stuck > threshold), alert color if > 0 | Exception monitoring, quiet when healthy |
| Recent receipts issued | List (most recent 5–10, scrollable) | Chronological feed |

**FR9.8 — Parent/Guardian**

| Stat | Format | Why |
|---|---|---|
| Outstanding balance per ward | Stat card per child, with "Pay now" CTA | One number, one action |
| Next invoice due date | Inline text/badge on the balance card | Doesn't need its own widget |
| Latest report card summary | Card (grade, average, "View full report" link) | Snapshot, not the full document |
| Attendance summary | Small ring/gauge (% this term) + recent absence list | % is the headline, list gives context |
| Upcoming timetable | Simple daily list (today) rather than full weekly grid | Parents care about "today," not the full week |
| Notifications | List, unread bolded/badged | Standard notification feed pattern |
| Payment history | Table (date, amount, method, receipt link) | Transactional records belong in a table |

**FR9.9 — Student**

| Stat | Format | Why |
|---|---|---|
| Today's timetable | List (chronological periods) | Simple, linear — no need for a full grid on a personal dashboard |
| Latest scores per subject | Table or small bar chart per subject | Table if precise scores matter; bar chart if visual comparison across subjects is the goal |
| Attendance record | Ring/gauge (% this term) | Quick self-check metric |
| Latest report card | Card with "View" link | Summary, not full document |
| Subject enrollment | List, grouped by compulsory/general/department | Categorized but flat — list with section headers |
| Special status (prefect/rep) | Badge, inline near name | Not data-heavy, just a flag |
| Notifications | List | Same feed pattern as Parent |

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
| Phase 5 — Operations | Attendance, fees/billing, receipts, pluggable payment gateway integration (`PaymentGatewayConfig` per provider, Monnify default + Paystack, hosted checkout, webhook reconciliation + polling fallback), manual bank-transfer payment + Super-Admin approval workflow, termly discount requests |
| Phase 6 — Notifications & Polish | WebSocket in-app notifications, Resend email integration for all events, notification preferences, audit log, performance hardening |
| Phase 7 — AI Scheduling | AI-assisted class & exam timetable generation (constraint-based: calculation-subject morning placement, spread rules; mid-term exam runs additionally take generation-time max-subjects-per-day and calculation/non-calculation subject duration parameters), AI-assisted invigilation assignment (excluding Bursar/Principal/VP, hard-excluding a subject's own teacher for JSS/SSS), AI-assisted weekly duty roster generation (admin-specified teacher count per week, JSS/SSS and Creche/Nursery/Primary generated as separate groups), `SchedulingConstraint` admin configuration UI, review & approval workflow for all AI-generated schedules (class timetables: Admin/Super-Admin; exam timetables, invigilation & weekly duty: Admin only) |
| Phase 8 — Dashboards | Real per-role dashboards (§6.9) replacing the Phase 1 shell — stat cards, tables, charts, and grids per FR9.4–FR9.9, built against data every prior phase already produces (fees/Phase 5, assessment/Phase 4, attendance/Phase 5, scheduling/Phase 7, notifications/Phase 6) |

---

## 10. Open Questions / Future Considerations

- Cross-school parents/staff: under one-application-per-school, a parent with wards in two different schools needs two entirely separate accounts (different deployments, different databases, different credentials, no shared identity or single sign-on between them). Worth surfacing clearly in onboarding UX rather than solving structurally in v1.
- Master-key custody and rotation plan for the application-level envelope encryption (where exactly the key lives, who can access it, how it's rotated) needs to be nailed down before any real `PaymentGatewayConfig` secret is stored — revisit moving to Vault/a KMS only if secret volume grows enough that manual key custody becomes the actual bottleneck, not by default.
- If the same team ends up operating many schools' deployments, is a lightweight internal tool worth building to track which schools are deployed, their versions, and their health? This is explicitly outside the product itself (§1.2) — a spreadsheet/runbook is probably sufficient at small scale, and formal tooling is only worth it once instance count makes manual tracking the actual bottleneck.
- Gateway integration model: reserved/virtual account per student (parent pays into a dedicated account number, auto-reconciled — Monnify supports this natively; Paystack's equivalent is Dedicated Virtual Accounts) vs. a one-time hosted checkout link generated per invoice. Recommend starting with hosted checkout (simpler, no per-student account provisioning against the gateway's API) and adding reserved/dedicated accounts later if the school wants a standing "always open" payment channel per student.
- Who absorbs the gateway's transaction fee — the school (netted from the amount received) or the parent (added on top at checkout)? Fee schedules differ between Monnify and Paystack, so this needs to be a configurable setting on `PaymentGatewayConfig` per provider, not hardcoded or assumed to transfer cleanly if the school switches its default gateway.
- Webhook reliability: gateway webhooks can arrive out of order or be retried; FR7.5/FR7.6 handle this via idempotency on `gatewayTransactionReference` plus a polling fallback, but the retry/backoff policy for the reconciliation job itself needs tuning once real transaction volume is observed — and per-provider, since Monnify's and Paystack's retry/webhook behavior aren't identical.
- Flutterwave (mentioned as a possible future gateway) isn't scoped for the initial `PaymentGatewayAdapter` build — Monnify (default) and Paystack are the two adapters built in Phase 5 (ARCHITECTURE.md §5, §10); adding a third provider later is expected to be "write one more adapter," not an architecture change, but hasn't been designed against Flutterwave's actual API yet.
- Whether a rejected `BANK_TRANSFER_MANUAL` submission should allow the Bursar to resubmit with corrected proof on the same `Payment` row, or must always create a fresh submission — affects whether `Payment.status` can transition `REJECTED → PENDING_APPROVAL` or only ever moves forward.
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
