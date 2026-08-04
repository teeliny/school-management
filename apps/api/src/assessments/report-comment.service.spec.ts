import { AssessmentComponentStatus, AssignmentType, ReportCommentType, ReportWindowStatus } from "@prisma/client";
import { ReportCommentService } from "./report-comment";
import type { RequestUser } from "../auth/jwt.strategy";
import type { CreateReportCommentDto } from "./dto/report-comment.dto";

function buildPrismaMock() {
  return {
    staffProfile: { findUnique: jest.fn() },
    studentProfile: { findUniqueOrThrow: jest.fn() },
    assessmentComponent: { findMany: jest.fn() },
    reportWindow: { findFirst: jest.fn() },
    reportComment: { upsert: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
}

function buildStaffAssignmentsMock() {
  return { findActiveAssignment: jest.fn() };
}

const USER: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: [] };
const STUDENT_WITH_CLASS = { currentClass: { id: "arm-1", classLevel: { category: "JSS" } } };

function buildDto(overrides: Partial<CreateReportCommentDto> = {}): CreateReportCommentDto {
  return {
    studentId: "student-1",
    termId: "term-1",
    commentType: ReportCommentType.CLASS_TEACHER,
    comment: "Great progress this term.",
    ...overrides,
  };
}

describe("ReportCommentService.write — subjectId consistency (PRD §3.6)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ReportCommentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ReportCommentService(prisma as never, buildStaffAssignmentsMock() as never);
  });

  it("rejects a SUBJECT comment with no subjectId", async () => {
    await expect(
      service.write(buildDto({ commentType: ReportCommentType.SUBJECT }), USER, false),
    ).rejects.toThrow(/subjectId is required/);
  });

  it("rejects a CLASS_TEACHER comment that includes a subjectId", async () => {
    await expect(
      service.write(buildDto({ subjectId: "subj-1" }), USER, false),
    ).rejects.toThrow(/subjectId is only valid/);
  });
});

describe("ReportCommentService.write — SUBJECT comments (component-gated, not window-gated)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let staffAssignments: ReturnType<typeof buildStaffAssignmentsMock>;
  let service: ReportCommentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = buildStaffAssignmentsMock();
    service = new ReportCommentService(prisma as never, staffAssignments as never);
    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue(STUDENT_WITH_CLASS);
  });

  it("allows the assigned subject teacher once every component for the term/class level has closed", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.assessmentComponent.findMany.mockResolvedValue([
      { status: AssessmentComponentStatus.CLOSED },
      { status: AssessmentComponentStatus.PUBLISHED },
    ]);
    prisma.reportComment.upsert.mockResolvedValue({ id: "comment-1" });

    await service.write(buildDto({ commentType: ReportCommentType.SUBJECT, subjectId: "subj-1" }), USER, false);

    expect(prisma.reportComment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ authorStaffId: "staff-1" }) }),
    );
  });

  it("rejects an unassigned subject teacher", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue(null);

    await expect(
      service.write(buildDto({ commentType: ReportCommentType.SUBJECT, subjectId: "subj-1" }), USER, false),
    ).rejects.toThrow(/not the assigned subject teacher/);
  });

  it("rejects while any component for the term/class level is still open", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.assessmentComponent.findMany.mockResolvedValue([
      { status: AssessmentComponentStatus.CLOSED },
      { status: AssessmentComponentStatus.OPEN },
    ]);

    await expect(
      service.write(buildDto({ commentType: ReportCommentType.SUBJECT, subjectId: "subj-1" }), USER, false),
    ).rejects.toThrow(/once every assessment component/);
    expect(prisma.reportComment.upsert).not.toHaveBeenCalled();
  });

  it("rejects when there are no components at all yet for the term/class level", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.assessmentComponent.findMany.mockResolvedValue([]);

    await expect(
      service.write(buildDto({ commentType: ReportCommentType.SUBJECT, subjectId: "subj-1" }), USER, false),
    ).rejects.toThrow(/once every assessment component/);
  });
});

describe("ReportCommentService.write — CLASS_TEACHER comments (window-gated)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let staffAssignments: ReturnType<typeof buildStaffAssignmentsMock>;
  let service: ReportCommentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = buildStaffAssignmentsMock();
    service = new ReportCommentService(prisma as never, staffAssignments as never);
    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue(STUDENT_WITH_CLASS);
  });

  it("allows the class teacher while the report window is OPEN, creating a new comment", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.reportWindow.findFirst.mockResolvedValue({ status: ReportWindowStatus.OPEN });
    prisma.reportComment.findFirst.mockResolvedValue(null);
    prisma.reportComment.create.mockResolvedValue({ id: "comment-1" });

    await service.write(buildDto(), USER, false);

    expect(prisma.reportComment.create).toHaveBeenCalledWith({
      data: {
        studentId: "student-1",
        termId: "term-1",
        commentType: ReportCommentType.CLASS_TEACHER,
        comment: "Great progress this term.",
        authorStaffId: "staff-1",
      },
    });
  });

  it("updates the existing CLASS_TEACHER comment instead of creating a duplicate", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.reportWindow.findFirst.mockResolvedValue({ status: ReportWindowStatus.OPEN });
    prisma.reportComment.findFirst.mockResolvedValue({ id: "existing-comment" });
    prisma.reportComment.update.mockResolvedValue({ id: "existing-comment" });

    await service.write(buildDto(), USER, false);

    expect(prisma.reportComment.create).not.toHaveBeenCalled();
    expect(prisma.reportComment.update).toHaveBeenCalledWith({
      where: { id: "existing-comment" },
      data: { comment: "Great progress this term.", authorStaffId: "staff-1" },
    });
  });

  it("rejects a caller who is not the class teacher", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue(null);

    await expect(service.write(buildDto(), USER, false)).rejects.toThrow(/not the class teacher/);
  });

  it("rejects while the report window is not OPEN", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.reportWindow.findFirst.mockResolvedValue({ status: ReportWindowStatus.CLOSED });

    await expect(service.write(buildDto(), USER, false)).rejects.toThrow(/not open/);
  });
});

describe("ReportCommentService.write — PRINCIPAL comments (role-scoped only, no date gate)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let staffAssignments: ReturnType<typeof buildStaffAssignmentsMock>;
  let service: ReportCommentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = buildStaffAssignmentsMock();
    service = new ReportCommentService(prisma as never, staffAssignments as never);
    prisma.reportComment.findFirst.mockResolvedValue(null);
    prisma.reportComment.create.mockResolvedValue({ id: "comment-1" });
  });

  it("allows a caller holding an active PRINCIPAL assignment, no date gate", async () => {
    staffAssignments.findActiveAssignment.mockImplementation(({ assignmentType }) =>
      Promise.resolve(assignmentType === AssignmentType.PRINCIPAL ? { staffId: "staff-1" } : null),
    );

    await service.write(buildDto({ commentType: ReportCommentType.PRINCIPAL }), USER, false);

    expect(prisma.studentProfile.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.reportComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ authorStaffId: "staff-1" }) }),
    );
  });

  it("allows a caller holding an active HEADTEACHER assignment instead", async () => {
    staffAssignments.findActiveAssignment.mockImplementation(({ assignmentType }) =>
      Promise.resolve(assignmentType === AssignmentType.HEADTEACHER ? { staffId: "staff-2" } : null),
    );

    await service.write(buildDto({ commentType: ReportCommentType.PRINCIPAL }), USER, false);

    expect(prisma.reportComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ authorStaffId: "staff-2" }) }),
    );
  });

  it("rejects a caller holding neither assignment", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue(null);

    await expect(service.write(buildDto({ commentType: ReportCommentType.PRINCIPAL }), USER, false)).rejects.toThrow(
      /PRINCIPAL or HEADTEACHER/,
    );
  });
});

describe("ReportCommentService.write — Admin override", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let staffAssignments: ReturnType<typeof buildStaffAssignmentsMock>;
  let service: ReportCommentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = buildStaffAssignmentsMock();
    service = new ReportCommentService(prisma as never, staffAssignments as never);
  });

  it("bypasses assignment/window/component checks entirely for any comment type", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue(null);
    prisma.reportComment.findFirst.mockResolvedValue(null);
    prisma.reportComment.create.mockResolvedValue({ id: "comment-1" });

    await service.write(buildDto({ commentType: ReportCommentType.PRINCIPAL }), USER, true);

    expect(staffAssignments.findActiveAssignment).not.toHaveBeenCalled();
    expect(prisma.reportComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ authorStaffId: null }) }),
    );
  });
});
