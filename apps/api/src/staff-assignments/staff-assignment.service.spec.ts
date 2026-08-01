import { AssignmentType } from "@prisma/client";
import { StaffAssignmentService } from "./staff-assignment";
import type { CreateStaffAssignmentDto } from "./dto/staff-assignment.dto";

function buildPrismaMock() {
  return {
    staffAssignment: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    staffProfile: { update: jest.fn() },
  };
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
