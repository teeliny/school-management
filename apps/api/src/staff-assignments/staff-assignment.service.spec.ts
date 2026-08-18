import { AssignmentType } from "@prisma/client";
import { StaffAssignmentService } from "./staff-assignment";
import type { CreateStaffAssignmentDto, SyncSubjectTeacherAssignmentsDto } from "./dto/staff-assignment.dto";

function buildPrismaMock() {
  const prisma = {
    staffAssignment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    staffProfile: { update: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  return prisma;
}

function buildDto(overrides: Partial<CreateStaffAssignmentDto> = {}): CreateStaffAssignmentDto {
  return {
    staffId: "staff-1",
    assignmentType: AssignmentType.CLASS_TEACHER,
    classArmId: "class-arm-1",
    academicSessionId: "session-1",
    ...overrides,
  };
}

describe("StaffAssignmentService.create — class-teacher duplicate rule (PRD FR3.3)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: StaffAssignmentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new StaffAssignmentService(prisma as never);
  });

  it("rejects a second active class teacher for the same class arm + session", async () => {
    prisma.staffAssignment.findFirst.mockResolvedValue({ id: "existing-assignment" });

    await expect(service.create(buildDto())).rejects.toThrow(
      /already has an active class teacher/,
    );
    expect(prisma.staffAssignment.create).not.toHaveBeenCalled();
  });

  it("allows the override when allowCoTeaching is set, without re-checking for a duplicate", async () => {
    prisma.staffAssignment.create.mockResolvedValue({
      id: "assignment-2",
      staffId: "staff-1",
      assignmentType: AssignmentType.CLASS_TEACHER,
    });

    await service.create(buildDto({ allowCoTeaching: true }));

    expect(prisma.staffAssignment.findFirst).not.toHaveBeenCalled();
    expect(prisma.staffAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ allowCoTeaching: expect.anything() }),
      }),
    );
    expect(prisma.staffProfile.update).toHaveBeenCalledWith({
      where: { id: "staff-1" },
      data: { isClassTeacher: true },
    });
  });

  it("does not apply the duplicate check to non-CLASS_TEACHER assignment types", async () => {
    prisma.staffAssignment.create.mockResolvedValue({
      id: "assignment-3",
      staffId: "staff-1",
      assignmentType: AssignmentType.SUBJECT_TEACHER,
    });

    await service.create(
      buildDto({ assignmentType: AssignmentType.SUBJECT_TEACHER, classArmId: undefined }),
    );

    expect(prisma.staffAssignment.findFirst).not.toHaveBeenCalled();
    expect(prisma.staffProfile.update).not.toHaveBeenCalled();
  });

  it("rejects a CLASS_TEACHER assignment with no classArmId", async () => {
    await expect(
      service.create(buildDto({ classArmId: undefined })),
    ).rejects.toThrow(/classArmId is required/);
  });
});

describe("StaffAssignmentService.findActiveAssignment (Phase 4 row-level auth helper)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: StaffAssignmentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new StaffAssignmentService(prisma as never);
  });

  it("returns null without querying assignments when the user has no StaffProfile", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue(null);

    const result = await service.findActiveAssignment({
      userId: "user-1",
      assignmentType: AssignmentType.SUBJECT_TEACHER,
      subjectId: "subj-1",
      classArmId: "arm-1",
    });

    expect(result).toBeNull();
    expect(prisma.staffAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("looks up the active assignment scoped to the resolved staffId + given filters", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue({ id: "staff-1" });
    prisma.staffAssignment.findFirst.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });

    const result = await service.findActiveAssignment({
      userId: "user-1",
      assignmentType: AssignmentType.SUBJECT_TEACHER,
      subjectId: "subj-1",
      classArmId: "arm-1",
    });

    expect(result).toEqual({ id: "assignment-1", staffId: "staff-1" });
    expect(prisma.staffAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        staffId: "staff-1",
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        subjectId: "subj-1",
        classArmId: "arm-1",
        isActive: true,
      },
    });
  });

  it("returns null when no matching active assignment exists", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue({ id: "staff-1" });
    prisma.staffAssignment.findFirst.mockResolvedValue(null);

    const result = await service.findActiveAssignment({
      userId: "user-1",
      assignmentType: AssignmentType.SUBJECT_TEACHER,
      subjectId: "subj-1",
      classArmId: "arm-1",
    });

    expect(result).toBeNull();
  });
});

function buildSyncDto(overrides: Partial<SyncSubjectTeacherAssignmentsDto> = {}): SyncSubjectTeacherAssignmentsDto {
  return {
    staffId: "staff-1",
    subjectId: "subject-1",
    academicSessionId: "session-1",
    classArmIds: [],
    ...overrides,
  };
}

describe("StaffAssignmentService.findSubjectTeacherClassArmIds", () => {
  it("returns only active SUBJECT_TEACHER class arm ids for the given staff+subject+session", async () => {
    const prisma = buildPrismaMock();
    const service = new StaffAssignmentService(prisma as never);
    prisma.staffAssignment.findMany.mockResolvedValue([{ classArmId: "arm-1" }, { classArmId: "arm-2" }]);

    const result = await service.findSubjectTeacherClassArmIds({
      staffId: "staff-1",
      subjectId: "subject-1",
      academicSessionId: "session-1",
    });

    expect(result).toEqual(["arm-1", "arm-2"]);
    expect(prisma.staffAssignment.findMany).toHaveBeenCalledWith({
      where: {
        staffId: "staff-1",
        subjectId: "subject-1",
        academicSessionId: "session-1",
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        isActive: true,
      },
      select: { classArmId: true },
    });
  });
});

describe("StaffAssignmentService.syncSubjectTeacherAssignments", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: StaffAssignmentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new StaffAssignmentService(prisma as never);
  });

  it("creates new rows for newly-checked class arms not previously present", async () => {
    prisma.staffAssignment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "new-row" }]);
    prisma.staffAssignment.findFirst.mockResolvedValue(null);

    await service.syncSubjectTeacherAssignments(buildSyncDto({ classArmIds: ["arm-1"] }));

    expect(prisma.staffAssignment.create).toHaveBeenCalledWith({
      data: {
        staffId: "staff-1",
        subjectId: "subject-1",
        classArmId: "arm-1",
        academicSessionId: "session-1",
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        startDate: undefined,
      },
    });
    expect(prisma.staffAssignment.updateMany).not.toHaveBeenCalled();
  });

  it("reactivates (via update, not create) a class arm whose prior row is revoked for the same key", async () => {
    prisma.staffAssignment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prisma.staffAssignment.findFirst.mockResolvedValue({ id: "revoked-row", startDate: null });

    await service.syncSubjectTeacherAssignments(buildSyncDto({ classArmIds: ["arm-1"] }));

    expect(prisma.staffAssignment.update).toHaveBeenCalledWith({
      where: { id: "revoked-row" },
      data: { isActive: true, endDate: null, startDate: null },
    });
    expect(prisma.staffAssignment.create).not.toHaveBeenCalled();
  });

  it("soft-revokes rows for arms removed from the submitted set, and leaves untouched arms alone", async () => {
    prisma.staffAssignment.findMany
      .mockResolvedValueOnce([
        { id: "keep-row", classArmId: "arm-1" },
        { id: "remove-row", classArmId: "arm-2" },
      ])
      .mockResolvedValueOnce([]);

    await service.syncSubjectTeacherAssignments(buildSyncDto({ classArmIds: ["arm-1"] }));

    expect(prisma.staffAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["remove-row"] } },
      data: { isActive: false, endDate: expect.any(Date) },
    });
    expect(prisma.staffAssignment.create).not.toHaveBeenCalled();
    expect(prisma.staffAssignment.update).not.toHaveBeenCalled();
  });

  it("scopes existing-row lookup to the given staff+subject+session, not other combinations", async () => {
    prisma.staffAssignment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.syncSubjectTeacherAssignments(buildSyncDto({ classArmIds: [] }));

    expect(prisma.staffAssignment.findMany).toHaveBeenCalledWith({
      where: {
        staffId: "staff-1",
        subjectId: "subject-1",
        academicSessionId: "session-1",
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        isActive: true,
      },
    });
    expect(prisma.staffAssignment.updateMany).not.toHaveBeenCalled();
  });
});
