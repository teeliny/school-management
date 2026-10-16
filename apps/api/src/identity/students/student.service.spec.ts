import { AssignmentType, Role } from "@prisma/client";
import { StudentService } from "./student";
import type { CreateStudentDto } from "./dto/create-student.dto";
import type { RequestUser } from "../../auth/jwt.strategy";

function buildTxMock() {
  return {
    user: { create: jest.fn(), findUnique: jest.fn() },
    userRole: { create: jest.fn() },
    studentProfile: { create: jest.fn(), findFirst: jest.fn() },
    studentGuardian: { create: jest.fn() },
    parentProfile: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    classArm: { findUnique: jest.fn() },
    $executeRaw: jest.fn(),
  };
}

function buildDto(guardian: CreateStudentDto["guardians"][number]): CreateStudentDto {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    classArmId: "arm-1",
    admissionDate: new Date("2025-09-01"),
    guardians: [guardian],
  };
}

describe("StudentService.create — guardian resolution (PRD FR1.3/FR1.5)", () => {
  let tx: ReturnType<typeof buildTxMock>;
  let prisma: { $transaction: jest.Mock };
  let userService: { grantRole: jest.Mock };
  let invitationService: { createInTx: jest.Mock; sendInviteEmail: jest.Mock };
  let enrollmentService: { syncCompulsoryEnrollmentsOnClassAssignment: jest.Mock };
  let service: StudentService;

  beforeEach(() => {
    tx = buildTxMock();
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
    userService = { grantRole: jest.fn() };
    invitationService = { createInTx: jest.fn(), sendInviteEmail: jest.fn() };
    enrollmentService = { syncCompulsoryEnrollmentsOnClassAssignment: jest.fn() };

    tx.user.create.mockResolvedValue({ id: "student-user-1" });
    tx.studentProfile.create.mockResolvedValue({ id: "student-1" });
    tx.classArm.findUnique.mockResolvedValue({
      id: "arm-1",
      classLevel: { category: "JSS" },
      academicSession: { startDate: new Date("2025-09-01") },
    });
    tx.studentProfile.findFirst.mockResolvedValue(null);

    service = new StudentService(
      prisma as never,
      userService as never,
      invitationService as never,
      enrollmentService as never,
      {} as never,
    );
  });

  it("links directly to an existing ParentProfile id without touching invitations or roles", async () => {
    tx.parentProfile.findUnique.mockResolvedValue({ id: "parent-existing" });

    const dto = buildDto({
      existingParentProfileId: "parent-existing",
      relationship: "MOTHER",
    } as CreateStudentDto["guardians"][number]);

    await service.create(dto);

    expect(tx.studentGuardian.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: "parent-existing" }) }),
    );
    expect(userService.grantRole).not.toHaveBeenCalled();
    expect(invitationService.createInTx).not.toHaveBeenCalled();
    expect(invitationService.sendInviteEmail).not.toHaveBeenCalled();
  });

  it("grants PARENT role and creates a fresh ParentProfile for an existing User (FR1.5)", async () => {
    tx.user.findUnique.mockResolvedValueOnce({ id: "existing-staff-user" }); // guardian email lookup
    tx.parentProfile.findUnique.mockResolvedValueOnce(null); // no ParentProfile yet
    tx.parentProfile.create.mockResolvedValueOnce({ id: "parent-new" });

    const dto = buildDto({
      email: "staff-parent@example.com",
      firstName: "Grace",
      lastName: "Hopper",
      relationship: "FATHER",
    } as CreateStudentDto["guardians"][number]);

    await service.create(dto);

    expect(userService.grantRole).toHaveBeenCalledWith("existing-staff-user", Role.PARENT, tx);
    expect(tx.parentProfile.create).toHaveBeenCalledWith({ data: { userId: "existing-staff-user" } });
    expect(tx.studentGuardian.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: "parent-new" }) }),
    );
    expect(invitationService.createInTx).not.toHaveBeenCalled();
  });

  it("inline-invites a brand-new guardian and sends the email after commit", async () => {
    tx.user.findUnique.mockResolvedValueOnce(null); // no existing user for that email
    invitationService.createInTx.mockResolvedValueOnce({
      invitation: { email: "new-parent@example.com", invitedRole: Role.PARENT },
      rawToken: "raw-token-123",
      userId: "invited-user-1",
    });
    tx.parentProfile.findUniqueOrThrow.mockResolvedValueOnce({ id: "parent-invited" });

    const dto = buildDto({
      email: "new-parent@example.com",
      firstName: "New",
      lastName: "Parent",
      relationship: "GUARDIAN",
    } as CreateStudentDto["guardians"][number]);

    await service.create(dto);

    expect(invitationService.createInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ email: "new-parent@example.com", invitedRole: Role.PARENT }),
    );
    expect(tx.studentGuardian.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentId: "parent-invited" }) }),
    );
    // Email is sent only after the transaction (and its callback) resolves.
    expect(invitationService.sendInviteEmail).toHaveBeenCalledWith(
      "new-parent@example.com",
      "raw-token-123",
      Role.PARENT,
    );
  });
});

describe("StudentService.findAllForUser — STAFF row-level scoping", () => {
  let prisma: {
    studentProfile: { findMany: jest.Mock };
    staffProfile: { findUnique: jest.Mock };
    staffAssignment: { findMany: jest.Mock; count: jest.Mock };
  };
  let service: StudentService;

  beforeEach(() => {
    prisma = {
      studentProfile: { findMany: jest.fn().mockResolvedValue([]) },
      staffProfile: { findUnique: jest.fn().mockResolvedValue({ id: "staff-1" }) },
      staffAssignment: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    service = new StudentService(prisma as never, {} as never, {} as never, {} as never, {} as never);
  });

  function staffUser(assignmentTypes: string[] = []): RequestUser {
    return { id: "user-1", roles: ["STAFF"], assignmentTypes };
  }

  it("returns every student for STAFF holding an active REGISTRAR/BURSAR assignment, without narrowing by class arm", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(1); // hasActiveSchoolWideAssignment

    await service.findAllForUser(staffUser());

    expect(prisma.staffAssignment.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignmentType: { in: [AssignmentType.REGISTRAR, AssignmentType.BURSAR] },
        }),
      }),
    );
    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "ACTIVE" } }),
    );
    expect(prisma.staffAssignment.findMany).not.toHaveBeenCalled();
  });

  it("scopes a PRINCIPAL-held assignment to JSS/SSS students only, without a DB round trip", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(0); // no REGISTRAR/BURSAR

    await service.findAllForUser(staffUser(["PRINCIPAL"]));

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ currentClass: { classLevel: { category: { in: ["JSS", "SSS"] } } } }, { status: "ACTIVE" }] },
      }),
    );
    expect(prisma.staffAssignment.findMany).not.toHaveBeenCalled();
  });

  it("scopes a HEADTEACHER-held assignment to Creche/Reception/Nursery/Primary students only", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(0); // no REGISTRAR/BURSAR

    await service.findAllForUser(staffUser(["HEADTEACHER"]));

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { currentClass: { classLevel: { category: { in: ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY"] } } } },
            { status: "ACTIVE" },
          ],
        },
      }),
    );
    expect(prisma.staffAssignment.findMany).not.toHaveBeenCalled();
  });

  it("narrows a PRINCIPAL's own JSS/SSS section scope by an explicit classLevelId, rather than the filter overwriting it", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(0); // no REGISTRAR/BURSAR

    await service.findAllForUser(staffUser(["PRINCIPAL"]), { classLevelId: "level-jss2" });

    // Composed via AND — a caller-supplied classLevelId must narrow within
    // the Principal's own section, never replace it outright.
    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { currentClass: { classLevel: { category: { in: ["JSS", "SSS"] } } } },
            { status: "ACTIVE" },
            { currentClass: { classLevelId: "level-jss2" } },
          ],
        },
      }),
    );
  });

  it("narrows Admin's unscoped (active-only) list by classLevelId", async () => {
    const adminUser: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };

    await service.findAllForUser(adminUser, { classLevelId: "level-jss2" });

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ status: "ACTIVE" }, { currentClass: { classLevelId: "level-jss2" } }] } }),
    );
  });

  it("lets only the Super-Admin opt in to non-active students, sorted after active ones", async () => {
    const superAdmin: RequestUser = { id: "sa-1", roles: ["SUPER_ADMIN"], assignmentTypes: [] };

    await service.findAllForUser(superAdmin, { includeInactive: true });

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined, orderBy: [{ status: "asc" }, { admissionNumber: "asc" }] }),
    );
  });

  it("ignores includeInactive for anyone but the Super-Admin", async () => {
    const adminUser: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };

    await service.findAllForUser(adminUser, { includeInactive: true });

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "ACTIVE" } }),
    );
  });

  it("falls back to class-arm scoping for STAFF with no school-wide assignment", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(0);
    prisma.staffAssignment.findMany.mockResolvedValueOnce([{ classArmId: "arm-1" }]);

    await service.findAllForUser(staffUser());

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ currentClassId: { in: ["arm-1"] } }, { status: "ACTIVE" }] } }),
    );
  });

  it("returns an empty list for STAFF with neither a school-wide assignment nor a class-arm assignment", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(0);
    prisma.staffAssignment.findMany.mockResolvedValueOnce([]);

    const result = await service.findAllForUser(staffUser());

    expect(result).toEqual([]);
    expect(prisma.studentProfile.findMany).not.toHaveBeenCalled();
  });

  it("narrows to actively-enrolled students when subjectId and termId are both supplied (gradebook roster)", async () => {
    const adminUser: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };

    prisma.term = { findUniqueOrThrow: jest.fn().mockResolvedValue({ endDate: new Date("2026-12-18") }) };
    prisma.subject = { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "subj-1", parentSubjectId: null }) };

    await service.findAllForUser(adminUser, { subjectId: "subj-1", termId: "term-1" });

    // termId also makes this that term's roster — a student who left on or
    // after its endDate (completed it) still appears.
    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { OR: [{ status: "ACTIVE" }, { inactiveSince: { gte: new Date("2026-12-18") } }] },
            {
              subjectEnrollments: {
                some: { subjectId: { in: ["subj-1"] }, termId: "term-1", status: "ACTIVE" },
              },
            },
          ],
        },
      }),
    );
  });

  it("matches the group parent's enrollment for a child subject (students are enrolled in the group, not each child)", async () => {
    const adminUser: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };

    prisma.term = { findUniqueOrThrow: jest.fn().mockResolvedValue({ endDate: new Date("2026-12-18") }) };
    prisma.subject = { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "child-1", parentSubjectId: "group-1" }) };

    await service.findAllForUser(adminUser, { subjectId: "child-1", termId: "term-1" });

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { OR: [{ status: "ACTIVE" }, { inactiveSince: { gte: new Date("2026-12-18") } }] },
            {
              subjectEnrollments: {
                some: { subjectId: { in: ["child-1", "group-1"] }, termId: "term-1", status: "ACTIVE" },
              },
            },
          ],
        },
      }),
    );
  });

  it("ignores subjectId/termId when only one of the pair is supplied", async () => {
    const adminUser: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };

    await service.findAllForUser(adminUser, { subjectId: "subj-1" });

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "ACTIVE" } }),
    );
  });
});

describe("StudentService — invoice void on status change", () => {
  function build() {
    const tx = { invoice: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    const service = new StudentService({} as never, {} as never, {} as never, {} as never, {} as never);
    const sync = (status: string) =>
      (service as unknown as { syncInvoiceVoidOnStatusChange: (t: unknown, id: string, s: string) => Promise<void> })
        .syncInvoiceVoidOnStatusChange(tx, "student-1", status);
    return { tx, sync };
  }

  it("voids every not-yet-PAID invoice when a student leaves ACTIVE, leaving PAID ones alone", async () => {
    const { tx, sync } = build();

    await sync("WITHDRAWN");

    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { studentId: "student-1", voidedAt: null, status: { not: "PAID" } },
      data: { voidedAt: expect.any(Date), voidReason: "Student withdrawn" },
    });
  });

  it("restores the student's void invoices when they're set back to ACTIVE", async () => {
    const { tx, sync } = build();

    await sync("ACTIVE");

    expect(tx.invoice.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { studentId: "student-1", voidedAt: { not: null } },
      data: { voidedAt: null, voidReason: null },
    });
  });
});
