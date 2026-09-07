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
      expect.not.objectContaining({ where: expect.anything() }),
    );
    expect(prisma.staffAssignment.findMany).not.toHaveBeenCalled();
  });

  it("scopes a PRINCIPAL-held assignment to JSS/SSS students only, without a DB round trip", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(0); // no REGISTRAR/BURSAR

    await service.findAllForUser(staffUser(["PRINCIPAL"]));

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { currentClass: { classLevel: { category: { in: ["JSS", "SSS"] } } } } }),
    );
    expect(prisma.staffAssignment.findMany).not.toHaveBeenCalled();
  });

  it("scopes a HEADTEACHER-held assignment to Creche/Reception/Nursery/Primary students only", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(0); // no REGISTRAR/BURSAR

    await service.findAllForUser(staffUser(["HEADTEACHER"]));

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { currentClass: { classLevel: { category: { in: ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY"] } } } },
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
            { currentClass: { classLevelId: "level-jss2" } },
          ],
        },
      }),
    );
  });

  it("narrows Admin's unscoped list by classLevelId without wrapping in AND (single condition stays unwrapped)", async () => {
    const adminUser: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };

    await service.findAllForUser(adminUser, { classLevelId: "level-jss2" });

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { currentClass: { classLevelId: "level-jss2" } } }),
    );
  });

  it("falls back to class-arm scoping for STAFF with no school-wide assignment", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(0);
    prisma.staffAssignment.findMany.mockResolvedValueOnce([{ classArmId: "arm-1" }]);

    await service.findAllForUser(staffUser());

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { currentClassId: { in: ["arm-1"] } } }),
    );
  });

  it("returns an empty list for STAFF with neither a school-wide assignment nor a class-arm assignment", async () => {
    prisma.staffAssignment.count.mockResolvedValueOnce(0);
    prisma.staffAssignment.findMany.mockResolvedValueOnce([]);

    const result = await service.findAllForUser(staffUser());

    expect(result).toEqual([]);
    expect(prisma.studentProfile.findMany).not.toHaveBeenCalled();
  });
});
