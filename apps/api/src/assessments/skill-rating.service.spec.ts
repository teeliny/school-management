import { AssignmentType, ReportWindowStatus, SkillRatingValue } from "@prisma/client";
import { SkillRatingService } from "./skill-rating";
import type { RequestUser } from "../auth/jwt.strategy";
import type { CreateSkillRatingDto } from "./dto/skill-rating.dto";

function buildPrismaMock() {
  return {
    staffProfile: { findUnique: jest.fn() },
    studentProfile: { findUniqueOrThrow: jest.fn() },
    reportWindow: { findFirst: jest.fn() },
    skillRating: { upsert: jest.fn() },
  };
}

function buildStaffAssignmentsMock() {
  return { findActiveAssignment: jest.fn() };
}

const USER: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: ["CLASS_TEACHER"] };

function buildDto(overrides: Partial<CreateSkillRatingDto> = {}): CreateSkillRatingDto {
  return {
    studentId: "student-1",
    termId: "term-1",
    skillAssessmentItemId: "item-1",
    rating: SkillRatingValue.GOOD,
    ...overrides,
  };
}

describe("SkillRatingService.rate (PRD §3.6 — CLASS_TEACHER + ReportWindow gating)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let staffAssignments: ReturnType<typeof buildStaffAssignmentsMock>;
  let service: SkillRatingService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = buildStaffAssignmentsMock();
    service = new SkillRatingService(prisma as never, staffAssignments as never);
    prisma.studentProfile.findUniqueOrThrow.mockResolvedValue({
      currentClass: { id: "arm-1", classLevelId: "level-1" },
    });
  });

  it("allows the class teacher to rate while the report window is OPEN", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.reportWindow.findFirst.mockResolvedValue({ status: ReportWindowStatus.OPEN });
    prisma.skillRating.upsert.mockResolvedValue({ id: "rating-1" });

    await service.rate(buildDto(), USER, false);

    expect(prisma.skillRating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ ratedByStaffId: "staff-1" }) }),
    );
  });

  it("rejects a caller who is not the class teacher for this student", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue(null);

    await expect(service.rate(buildDto(), USER, false)).rejects.toThrow(/not the class teacher/);
    expect(prisma.skillRating.upsert).not.toHaveBeenCalled();
  });

  it("rejects the class teacher when the report window is not OPEN", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.reportWindow.findFirst.mockResolvedValue({ status: ReportWindowStatus.CLOSED });

    await expect(service.rate(buildDto(), USER, false)).rejects.toThrow(/not open/);
    expect(prisma.skillRating.upsert).not.toHaveBeenCalled();
  });

  it("rejects when no ReportWindow exists yet for this term/class level", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.reportWindow.findFirst.mockResolvedValue(null);

    await expect(service.rate(buildDto(), USER, false)).rejects.toThrow(/not open/);
  });

  it("allows an Admin override regardless of assignment or window status", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue(null);
    prisma.skillRating.upsert.mockResolvedValue({ id: "rating-1" });

    await service.rate(buildDto(), USER, true);

    expect(staffAssignments.findActiveAssignment).not.toHaveBeenCalled();
    expect(prisma.reportWindow.findFirst).not.toHaveBeenCalled();
    expect(prisma.skillRating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ ratedByStaffId: null }) }),
    );
  });

  it("verifies the CLASS_TEACHER assignment check is scoped to this student's class arm", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ staffId: "staff-1" });
    prisma.reportWindow.findFirst.mockResolvedValue({ status: ReportWindowStatus.OPEN });

    await service.rate(buildDto(), USER, false);

    expect(staffAssignments.findActiveAssignment).toHaveBeenCalledWith({
      userId: "user-1",
      assignmentType: AssignmentType.CLASS_TEACHER,
      classArmId: "arm-1",
    });
  });
});
