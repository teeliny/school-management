import { subject } from "@casl/ability";
import { AbilityFactory } from "./ability.factory";
import type { RequestUser } from "../auth/jwt.strategy";

describe("AbilityFactory", () => {
  const factory = new AbilityFactory();

  function userWith(roles: string[], assignmentTypes: string[] = []): RequestUser {
    return { id: "user-1", roles, assignmentTypes };
  }

  it("SUPER_ADMIN can manage anything", () => {
    const ability = factory.createForUser(userWith(["SUPER_ADMIN"]));
    expect(ability.can("manage", "AcademicStructure")).toBe(true);
    expect(ability.can("invite", "Invitation")).toBe(true);
    expect(ability.can("invite", subject("Invitation", { invitedRole: "ADMIN" }))).toBe(true);
  });

  it("ADMIN can manage academic structure and invite Staff/Parent, but not Admin", () => {
    const ability = factory.createForUser(userWith(["ADMIN"]));
    expect(ability.can("manage", "AcademicStructure")).toBe(true);
    expect(ability.can("invite", subject("Invitation", { invitedRole: "STAFF" }))).toBe(true);
    expect(ability.can("invite", subject("Invitation", { invitedRole: "PARENT" }))).toBe(true);
    // PRD FR1.2: appointing an Admin is an owner-only action.
    expect(ability.can("invite", subject("Invitation", { invitedRole: "ADMIN" }))).toBe(false);
  });

  it("ADMIN can manage people profiles and most StaffAssignments, but not Bursar/Registrar", () => {
    const ability = factory.createForUser(userWith(["ADMIN"]));
    expect(ability.can("manage", "StaffProfile")).toBe(true);
    expect(ability.can("manage", "ParentProfile")).toBe(true);
    expect(ability.can("manage", "StudentProfile")).toBe(true);
    expect(
      ability.can("manage", subject("StaffAssignment", { assignmentType: "CLASS_TEACHER" })),
    ).toBe(true);
    // PRD FR3.1/§5: Bursar and Registrar report to Super-Admin, not Admin.
    expect(
      ability.can("manage", subject("StaffAssignment", { assignmentType: "BURSAR" })),
    ).toBe(false);
    expect(
      ability.can("manage", subject("StaffAssignment", { assignmentType: "REGISTRAR" })),
    ).toBe(false);
  });

  it("SUPER_ADMIN can manage Bursar/Registrar assignments", () => {
    const ability = factory.createForUser(userWith(["SUPER_ADMIN"]));
    expect(
      ability.can("manage", subject("StaffAssignment", { assignmentType: "BURSAR" })),
    ).toBe(true);
    expect(
      ability.can("manage", subject("StaffAssignment", { assignmentType: "REGISTRAR" })),
    ).toBe(true);
  });

  it("STAFF/PARENT/STUDENT have no Phase 1 permissions", () => {
    for (const role of ["STAFF", "PARENT", "STUDENT"]) {
      const ability = factory.createForUser(userWith([role]));
      expect(ability.can("manage", "AcademicStructure")).toBe(false);
      expect(ability.can("invite", "Invitation")).toBe(false);
      expect(ability.can("manage", "StaffAssignment")).toBe(false);
      expect(ability.can("manage", "StudentProfile")).toBe(false);
    }
  });

  it("a user with no roles has no permissions", () => {
    const ability = factory.createForUser(userWith([]));
    expect(ability.can("manage", "AcademicStructure")).toBe(false);
  });

  // PRD §3.3/§5 (Phase 3 — Academics)
  it("ADMIN can manage the subject catalogue and manual timetable", () => {
    const ability = factory.createForUser(userWith(["ADMIN"]));
    expect(ability.can("manage", "Subject")).toBe(true);
    expect(ability.can("manage", "ClassSubject")).toBe(true);
    expect(ability.can("manage", "SubjectGroupWeight")).toBe(true);
    expect(ability.can("manage", "StudentSubjectEnrollment")).toBe(true);
    expect(ability.can("manage", "StudentDepartment")).toBe(true);
    expect(ability.can("manage", "TimetableSlot")).toBe(true);
  });

  it("a bare STAFF user cannot manage the timetable", () => {
    const ability = factory.createForUser(userWith(["STAFF"]));
    expect(ability.can("manage", "TimetableSlot")).toBe(false);
  });

  it("a STAFF user holding an active REGISTRAR assignment can manage the timetable but not the subject catalogue", () => {
    const ability = factory.createForUser(userWith(["STAFF"], ["REGISTRAR"]));
    expect(ability.can("manage", "TimetableSlot")).toBe(true);
    expect(ability.can("manage", "Subject")).toBe(false);
  });

  it("Broadsheet is readable by SUPER_ADMIN and by a PRINCIPAL/HEADTEACHER assignment, but not by ADMIN or a bare STAFF/REGISTRAR", () => {
    expect(factory.createForUser(userWith(["SUPER_ADMIN"])).can("read", "Broadsheet")).toBe(true);
    expect(factory.createForUser(userWith(["STAFF"], ["PRINCIPAL"])).can("read", "Broadsheet")).toBe(true);
    expect(factory.createForUser(userWith(["STAFF"], ["HEADTEACHER"])).can("read", "Broadsheet")).toBe(true);
    expect(factory.createForUser(userWith(["ADMIN"])).can("read", "Broadsheet")).toBe(false);
    expect(factory.createForUser(userWith(["STAFF"])).can("read", "Broadsheet")).toBe(false);
    expect(factory.createForUser(userWith(["STAFF"], ["REGISTRAR"])).can("read", "Broadsheet")).toBe(false);
  });

  // PRD §3.7/§6.5 (Phase 5 slice 1 — Attendance)
  it("ADMIN/SUPER_ADMIN can manage the whole attendance domain, unconditioned", () => {
    for (const role of ["ADMIN", "SUPER_ADMIN"]) {
      const ability = factory.createForUser(userWith([role]));
      expect(ability.can("manage", "AttendanceSession")).toBe(true);
      expect(ability.can("manage", "AttendanceRecord")).toBe(true);
      expect(ability.can("manage", "SchoolHoliday")).toBe(true);
    }
  });

  it("a REGISTRAR can read all attendance but only manage STAFF-type sessions when checked against an instance", () => {
    const ability = factory.createForUser(userWith(["STAFF"], ["REGISTRAR"]));
    expect(ability.can("read", "AttendanceSession")).toBe(true);
    expect(ability.can("manage", subject("AttendanceSession", { type: "STAFF" }))).toBe(true);
    expect(ability.can("manage", subject("AttendanceSession", { type: "STUDENT" }))).toBe(false);
    expect(ability.can("manage", "AttendanceRecord")).toBe(true);
  });

  it("a bare-string manage check ignores field conditions — CASL quirk the services must not rely on for override detection", () => {
    // There's no subject instance to test {type: "STAFF"} against, so CASL
    // matches Registrar's conditioned grant anyway. This is exactly why
    // AttendanceSessionService/AttendanceRecordService.checkIsAdminOverride
    // check both type instances instead of this bare form — asserted here
    // so the quirk stays documented if @casl/ability's behavior ever
    // changes underneath this codebase.
    const ability = factory.createForUser(userWith(["STAFF"], ["REGISTRAR"]));
    expect(ability.can("manage", "AttendanceSession")).toBe(true);
  });

  it("a bare STAFF user (no REGISTRAR assignment) has no attendance permissions", () => {
    const ability = factory.createForUser(userWith(["STAFF"]));
    expect(ability.can("read", "AttendanceSession")).toBe(false);
    expect(ability.can("manage", subject("AttendanceSession", { type: "STAFF" }))).toBe(false);
    expect(ability.can("manage", "SchoolHoliday")).toBe(false);
  });

  // PRD §3.9/§6.7 (Phase 5 slice 2a — Fees core)
  const FEE_SUBJECTS = ["FeeStructure", "Invoice", "InvoiceLineItem", "Payment", "Receipt", "DiscountRequest"] as const;

  it("a BURSAR can manage the whole fees domain", () => {
    const ability = factory.createForUser(userWith(["STAFF"], ["BURSAR"]));
    for (const subjectName of FEE_SUBJECTS) {
      expect(ability.can("manage", subjectName)).toBe(true);
    }
  });

  it("SUPER_ADMIN can manage the whole fees domain via manage-all", () => {
    const ability = factory.createForUser(userWith(["SUPER_ADMIN"]));
    for (const subjectName of FEE_SUBJECTS) {
      expect(ability.can("manage", subjectName)).toBe(true);
    }
  });

  it("ADMIN has zero visibility into the fees domain — the one place a regression would be easy to miss", () => {
    const ability = factory.createForUser(userWith(["ADMIN"]));
    for (const subjectName of FEE_SUBJECTS) {
      expect(ability.can("manage", subjectName)).toBe(false);
      expect(ability.can("read", subjectName)).toBe(false);
    }
  });

  it("a PARENT can read invoices/payments/receipts but not manage them, and cannot read FeeStructure", () => {
    const ability = factory.createForUser(userWith(["PARENT"]));
    expect(ability.can("read", "Invoice")).toBe(true);
    expect(ability.can("read", "Payment")).toBe(true);
    expect(ability.can("read", "Receipt")).toBe(true);
    expect(ability.can("manage", "Invoice")).toBe(false);
    expect(ability.can("read", "FeeStructure")).toBe(false);
  });

  it("a bare STAFF/STUDENT user has no fees permissions at all", () => {
    for (const role of ["STAFF", "STUDENT"]) {
      const ability = factory.createForUser(userWith([role]));
      for (const subjectName of FEE_SUBJECTS) {
        expect(ability.can("manage", subjectName)).toBe(false);
        expect(ability.can("read", subjectName)).toBe(false);
      }
    }
  });

  // PRD FR7.7 (Phase 5 slice 2b — Payment Gateway Integration)
  it("BURSAR and SUPER_ADMIN can manage PaymentGatewayConfig", () => {
    expect(factory.createForUser(userWith(["STAFF"], ["BURSAR"])).can("manage", "PaymentGatewayConfig")).toBe(true);
    expect(factory.createForUser(userWith(["SUPER_ADMIN"])).can("manage", "PaymentGatewayConfig")).toBe(true);
  });

  it("ADMIN cannot manage PaymentGatewayConfig — same fees-domain exclusion", () => {
    expect(factory.createForUser(userWith(["ADMIN"])).can("manage", "PaymentGatewayConfig")).toBe(false);
    expect(factory.createForUser(userWith(["ADMIN"])).can("read", "PaymentGatewayConfig")).toBe(false);
  });
});
