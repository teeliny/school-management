import { AssessmentComponentStatus } from "@prisma/client";
import { ScoreEntryService } from "./score-entry";
import type { RequestUser } from "../auth/jwt.strategy";
import type { CreateScoreEntryDto } from "./dto/score-entry.dto";

function buildPrismaMock() {
  return {
    staffProfile: { findUnique: jest.fn() },
    assessmentComponent: { findUniqueOrThrow: jest.fn() },
    scoreEntry: { upsert: jest.fn() },
  };
}

function buildStaffAssignmentsMock() {
  return { findActiveAssignment: jest.fn() };
}

const USER: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: ["SUBJECT_TEACHER"] };

function buildDto(overrides: Partial<CreateScoreEntryDto> = {}): CreateScoreEntryDto {
  return {
    studentId: "student-1",
    subjectId: "subj-1",
    assessmentComponentId: "comp-1",
    classArmId: "arm-1",
    score: 15,
    ...overrides,
  };
}

describe("ScoreEntryService.enter (PRD §3.6/FR4.2)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let staffAssignments: ReturnType<typeof buildStaffAssignmentsMock>;
  let service: ScoreEntryService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = buildStaffAssignmentsMock();
    service = new ScoreEntryService(prisma as never, staffAssignments as never);
  });

  it("allows the assigned subject teacher to score while the component is OPEN", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({
      id: "comp-1",
      status: AssessmentComponentStatus.OPEN,
    });
    prisma.scoreEntry.upsert.mockResolvedValue({ id: "score-1" });

    await service.enter(buildDto(), USER, false);

    expect(prisma.scoreEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ enteredByStaffId: "staff-1", score: 15 }),
      }),
    );
  });

  it("rejects a teacher with no active assignment for this subject/class", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue(null);

    await expect(service.enter(buildDto(), USER, false)).rejects.toThrow(/not the assigned subject teacher/);
    expect(prisma.scoreEntry.upsert).not.toHaveBeenCalled();
  });

  it("rejects the assigned teacher when the component is not OPEN", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({
      id: "comp-1",
      status: AssessmentComponentStatus.CLOSED,
    });

    await expect(service.enter(buildDto(), USER, false)).rejects.toThrow(/not open/);
    expect(prisma.scoreEntry.upsert).not.toHaveBeenCalled();
  });

  it("allows an Admin override regardless of assignment or component status", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue(null);
    prisma.scoreEntry.upsert.mockResolvedValue({ id: "score-1" });

    await service.enter(buildDto(), USER, true);

    expect(staffAssignments.findActiveAssignment).not.toHaveBeenCalled();
    expect(prisma.assessmentComponent.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.scoreEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ enteredByStaffId: null }),
      }),
    );
  });
});
