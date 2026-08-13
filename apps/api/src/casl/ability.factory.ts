import { Injectable } from "@nestjs/common";
import { AbilityBuilder, createMongoAbility, MongoAbility } from "@casl/ability";
import type { RequestUser } from "../auth/jwt.strategy";

/**
 * PRD §5 permission matrix, ARCHITECTURE.md §7: this is the mechanism that
 * makes role-scoped rules enforceable in one place instead of re-implemented
 * per-endpoint — the boundary that actually matters in a single-tenant app,
 * since the tenant boundary is handled for free by deployment isolation.
 *
 * Phase 1 keeps the rule set intentionally small (only what Identity &
 * Academic Structure need); every later phase adds rules here rather than
 * inventing its own ad-hoc auth pattern.
 */
export type Action = "manage" | "invite" | "read";
export type Subject =
  | "all"
  | "AcademicStructure"
  | "Invitation"
  | "AdminProfile"
  | "StaffProfile"
  | "ParentProfile"
  | "StudentProfile"
  | "StaffAssignment"
  | "Subject"
  | "ClassSubject"
  | "SubjectGroupWeight"
  | "StudentSubjectEnrollment"
  | "StudentDepartment"
  | "TimetableSlot"
  | "AssessmentComponent"
  | "ScoreEntry"
  | "TermReportCard"
  | "SkillAssessmentItem"
  | "ReportWindow"
  | "SkillRating"
  | "ReportComment"
  | "Broadsheet"
  | "AttendanceSession"
  | "AttendanceRecord"
  | "SchoolHoliday"
  | "FeeStructure"
  | "Invoice"
  | "InvoiceLineItem"
  | "Payment"
  | "Receipt"
  | "PaymentGatewayConfig"
  | "DiscountRequest"
  | "NotificationTemplate"
  | "SchedulingConstraint"
  | "ScheduleGenerationRequest";
export type AppAbility = MongoAbility<
  [Action, Subject | { invitedRole: string } | { assignmentType: string } | { type: string }]
>;

@Injectable()
export class AbilityFactory {
  createForUser(user: RequestUser): AppAbility {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (user.roles.includes("SUPER_ADMIN")) {
      can("manage", "all");
    } else if (user.roles.includes("ADMIN")) {
      can("manage", "AcademicStructure");
      can("invite", "Invitation");
      // PRD FR1.2: appointing an Admin is an owner-only action.
      cannot("invite", "Invitation", { invitedRole: "ADMIN" });

      // PRD §5: Admin can view/manage every user type and create/edit
      // students, but Bursar/Registrar assignments report to Super-Admin
      // only (FR3.1) — everything else about StaffAssignment is Admin's.
      can("manage", ["AdminProfile", "StaffProfile", "ParentProfile", "StudentProfile"]);
      can("manage", "StaffAssignment");
      cannot("manage", "StaffAssignment", { assignmentType: "BURSAR" });
      cannot("manage", "StaffAssignment", { assignmentType: "REGISTRAR" });

      // PRD §3.3/§5: subject catalogue + manual class timetable are both
      // Admin-manageable.
      can("manage", [
        "Subject",
        "ClassSubject",
        "SubjectGroupWeight",
        "StudentSubjectEnrollment",
        "StudentDepartment",
        "TimetableSlot",
      ]);

      // PRD §3.6/§5: Admin defines the assessment structure and can open/
      // close/publish components manually; Admin/Super-Admin can also enter
      // or correct a score outside the normal SUBJECT_TEACHER+OPEN path
      // (override), which the manual check in ScoreEntryService falls back
      // to when this flat capability is present.
      can("manage", ["AssessmentComponent", "ScoreEntry", "TermReportCard"]);

      // PRD §3.6/§5: Admin/Super-Admin configures the skills list and report
      // windows, and can rate skills / write any comment as override outside
      // the normal CLASS_TEACHER/SUBJECT_TEACHER/PRINCIPAL paths — same
      // override-detection shape as ScoreEntry above.
      can("manage", ["SkillAssessmentItem", "ReportWindow", "SkillRating", "ReportComment"]);

      // PRD §3.7/§5: Admin manages the whole attendance domain (holidays,
      // both STUDENT- and STAFF-type sessions/records) and can override the
      // back-dating window (FR5.2) — unconditioned, which is what makes a
      // plain `ability.can("manage", "AttendanceSession")` check (no subject
      // instance) evaluate true for Admin/Super-Admin only, not Registrar
      // (whose grant below is conditioned on session type).
      can("manage", ["AttendanceSession", "AttendanceRecord", "SchoolHoliday"]);

      // PRD §3.10: Admin can customize this school's default notification
      // copy. Notification/NotificationPreference need no Subject here —
      // every authenticated user manages only their own, scoped entirely at
      // the service layer (same reasoning as `/auth/me`), not via CASL.
      can("manage", "NotificationTemplate");

      // PRD §3.8: SchedulingConstraint is an Admin-config resource like
      // AssessmentComponent/GradeScale. ScheduleGenerationRequest is
      // deliberately NOT granted here — §5 footnote 5: a plain Admin holding
      // neither PRINCIPAL nor HEADTEACHER cannot trigger generation at all;
      // that grant lives only in the REGISTRAR/PRINCIPAL/HEADTEACHER
      // branches below, additive on top of this one for an Admin who also
      // holds one of those titles.
      can("manage", "SchedulingConstraint");
    }

    // PRD §5: Registrar manages the class timetable even though it's not a
    // Role — it's a StaffAssignment.assignmentType, so this check is
    // additive on top of whatever the role branches above already granted,
    // not exclusive with them (a STAFF user who's also Registrar gets
    // exactly this one extra permission, nothing else).
    if (user.assignmentTypes?.includes("REGISTRAR")) {
      can("manage", "TimetableSlot");
      // Needed to pick a staff member for a TimetableSlot and to build the
      // roster for a STAFF-type attendance register below — StaffProfile
      // otherwise only appears in the ADMIN branch above, which a plain
      // Registrar doesn't get.
      can("read", "StaffProfile");

      // PRD §3.7/§6.5 FR5.1/FR5.3: Registrar takes STAFF-type attendance
      // (session write scoped to type=STAFF via the condition below) and
      // views analytics across every session type (unconditioned read).
      can("read", "AttendanceSession");
      can("manage", "AttendanceSession", { type: "STAFF" });
      can("manage", "AttendanceRecord");

      // PRD §5 footnote 5: Registrar is unscoped for triggering AI
      // schedule generation, same as Super-Admin — the category-scoping
      // check itself (Principal→JSS/SSS, Headteacher→CRECHE/NURSERY/
      // PRIMARY) is a service-layer check in
      // ScheduleGenerationRequestService.assertCanTrigger, not a CASL
      // condition.
      can("manage", "ScheduleGenerationRequest");
    }

    // PRD §3.9/§5: the entire fee/finance domain is invisible to Admin —
    // deliberately no grant for any of these five Subjects anywhere in the
    // ADMIN branch above. Bursar (StaffAssignment.assignmentType = BURSAR)
    // gets an unconditioned domain-wide grant; Super-Admin already has it
    // for free via "manage all". No CASL condition is used here at all —
    // unlike Attendance, per-row scoping (which parent can see which
    // invoice) is done entirely at the service layer, sidestepping the
    // bare-string-vs-conditioned-grant pitfall that pattern hit.
    if (user.assignmentTypes?.includes("BURSAR")) {
      can("manage", ["FeeStructure", "Invoice", "InvoiceLineItem", "Payment", "Receipt", "DiscountRequest"]);

      // PRD FR7.7, Phase 5 Slice 2b: gateway credentials configuration is
      // part of the same Bursar/Super-Admin-only fee/finance domain.
      can("manage", "PaymentGatewayConfig");
    }

    // PRD FR7.4: a parent may read (never write) invoices/payments/receipts
    // — scoped to her own wards at the service layer (StudentGuardian join,
    // same shape as TermReportCardService.findForUser). FeeStructure is
    // deliberately not granted here — PRD's parent-access line covers
    // invoices/receipts only, not the raw fee schedule.
    if (user.roles.includes("PARENT")) {
      can("read", ["Invoice", "Payment", "Receipt"]);
    }

    // Principal/Headteacher get near-Admin parity — everything the ADMIN
    // branch above grants *except* user/profile management (AdminProfile/
    // StaffProfile/ParentProfile/StudentProfile/StaffAssignment) and
    // inviting new accounts, both of which stay Admin/Super-Admin-only.
    // Mirrors the ADMIN branch's grants capability-for-capability rather
    // than a shared helper (the ADMIN branch isn't factored out elsewhere
    // in this file either) — keep the two in sync by hand if either
    // changes. Also carries the Broadsheet read grant this StaffAssignment
    // type already had on its own before this near-parity extension.
    if (user.assignmentTypes?.includes("PRINCIPAL") || user.assignmentTypes?.includes("HEADTEACHER")) {
      can("manage", "AcademicStructure");

      can("manage", [
        "Subject",
        "ClassSubject",
        "SubjectGroupWeight",
        "StudentSubjectEnrollment",
        "StudentDepartment",
        "TimetableSlot",
      ]);

      // Needed to pick a staff member for a TimetableSlot — same "manage
      // TimetableSlot needs the staff picker" reasoning as the REGISTRAR
      // branch's own identical grant below. Without this, Principal/
      // Headteacher could create/edit timetable slots (per the grant just
      // above) but never populate the Teacher select at all.
      can("read", "StaffProfile");

      can("manage", ["AssessmentComponent", "ScoreEntry", "TermReportCard"]);

      can("manage", ["SkillAssessmentItem", "ReportWindow", "SkillRating", "ReportComment"]);

      can("manage", ["AttendanceSession", "AttendanceRecord", "SchoolHoliday"]);

      can("manage", "NotificationTemplate");

      can("read", "Broadsheet");

      // PRD §5 footnote 5: a Principal/Headteacher-held assignment is what
      // unlocks triggering AI schedule generation at all for a non-Super-
      // Admin/Registrar user — scoped to that title's class-level group
      // (JSS/SSS vs. CRECHE/NURSERY/PRIMARY) by
      // ScheduleGenerationRequestService.assertCanTrigger.
      can("manage", "ScheduleGenerationRequest");
    }

    return build();
  }
}
