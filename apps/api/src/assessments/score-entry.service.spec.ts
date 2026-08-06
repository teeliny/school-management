import { AssessmentComponentStatus, ClassLevelCategory } from "@prisma/client";
import { ScoreEntryService } from "./score-entry";
import type { RequestUser } from "../auth/jwt.strategy";
import type { CreateScoreEntryDto } from "./dto/score-entry.dto";

function buildPrismaMock() {
  return {
    staffProfile: { findUnique: jest.fn() },
    classArm: { findUniqueOrThrow: jest.fn() },
    assessmentComponent: { findUniqueOrThrow: jest.fn() },
    subject: { findUniqueOrThrow: jest.fn() },
    scoreEntry: { upsert: jest.fn() },
  };
}

function buildStaffAssignmentsMock() {
  return { findActiveAssignment: jest.fn() };
}

function buildClassSubjectTermStatusMock() {
  return { assertActiveForTerm: jest.fn() };
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
  let classSubjectTermStatus: ReturnType<typeof buildClassSubjectTermStatusMock>;
  let service: ScoreEntryService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = buildStaffAssignmentsMock();
    classSubjectTermStatus = buildClassSubjectTermStatusMock();
    service = new ScoreEntryService(prisma as never, staffAssignments as never, classSubjectTermStatus as never);
    prisma.classArm.findUniqueOrThrow.mockResolvedValue({
      id: "arm-1",
      classLevelId: "level-1",
      classLevel: { category: ClassLevelCategory.JSS },
      academicSessionId: "session-1",
    });
    prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({
      id: "comp-1",
      termId: "term-1",
      status: AssessmentComponentStatus.OPEN,
    });
    prisma.subject.findUniqueOrThrow.mockResolvedValue({ id: "subj-1", isGroup: false });
  });

  it("allows the assigned subject teacher to score while the component is OPEN", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
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
    prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({
      id: "comp-1",
      termId: "term-1",
      status: AssessmentComponentStatus.CLOSED,
    });
    prisma.staffProfile.findUnique.mockResolvedValue(null);
    prisma.scoreEntry.upsert.mockResolvedValue({ id: "score-1" });

    await service.enter(buildDto(), USER, true);

    expect(staffAssignments.findActiveAssignment).not.toHaveBeenCalled();
    expect(prisma.scoreEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ enteredByStaffId: null }),
      }),
    );
  });

  it("checks the class-subject's per-term status before writing, for both regular and override entry", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    prisma.scoreEntry.upsert.mockResolvedValue({ id: "score-1" });

    await service.enter(buildDto(), USER, false);

    expect(classSubjectTermStatus.assertActiveForTerm).toHaveBeenCalledWith({
      subjectId: "subj-1",
      classLevelCategory: ClassLevelCategory.JSS,
      termId: "term-1",
    });
  });

  it("blocks score entry — even as an Admin override — when the subject is disabled for this class+term", async () => {
    classSubjectTermStatus.assertActiveForTerm.mockRejectedValue(new Error("disabled for this class for this term"));

    await expect(service.enter(buildDto(), USER, true)).rejects.toThrow(/disabled for this class for this term/);
    expect(prisma.scoreEntry.upsert).not.toHaveBeenCalled();
  });

  it("rejects score entry against a group subject for a regular teacher", async () => {
    prisma.subject.findUniqueOrThrow.mockResolvedValue({ id: "subj-1", isGroup: true });

    await expect(service.enter(buildDto(), USER, false)).rejects.toThrow(/group subject/);
    expect(prisma.scoreEntry.upsert).not.toHaveBeenCalled();
    expect(staffAssignments.findActiveAssignment).not.toHaveBeenCalled();
  });

  it("rejects score entry against a group subject — even as an Admin override", async () => {
    prisma.subject.findUniqueOrThrow.mockResolvedValue({ id: "subj-1", isGroup: true });

    await expect(service.enter(buildDto(), USER, true)).rejects.toThrow(/group subject/);
    expect(prisma.scoreEntry.upsert).not.toHaveBeenCalled();
  });

  it("rejects a score above the component's maxScore", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({
      id: "comp-1",
      termId: "term-1",
      status: AssessmentComponentStatus.OPEN,
      maxScore: 20,
    });

    await expect(service.enter(buildDto({ score: 25 }), USER, false)).rejects.toThrow(/cannot exceed/);
    expect(prisma.scoreEntry.upsert).not.toHaveBeenCalled();
  });

  it("rejects a score above the component's maxScore — even as an Admin override", async () => {
    prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({
      id: "comp-1",
      termId: "term-1",
      status: AssessmentComponentStatus.CLOSED,
      maxScore: 20,
    });

    await expect(service.enter(buildDto({ score: 21 }), USER, true)).rejects.toThrow(/cannot exceed/);
    expect(prisma.scoreEntry.upsert).not.toHaveBeenCalled();
  });

  it("allows a score exactly at the component's maxScore", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    prisma.assessmentComponent.findUniqueOrThrow.mockResolvedValue({
      id: "comp-1",
      termId: "term-1",
      status: AssessmentComponentStatus.OPEN,
      maxScore: 20,
    });
    prisma.scoreEntry.upsert.mockResolvedValue({ id: "score-1" });

    await service.enter(buildDto({ score: 20 }), USER, false);

    expect(prisma.scoreEntry.upsert).toHaveBeenCalled();
  });
});
