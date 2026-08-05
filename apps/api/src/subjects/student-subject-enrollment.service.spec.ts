import { ClassLevelCategory, EnrollmentStatus, SubjectType } from "@prisma/client";
import { StudentSubjectEnrollmentService } from "./student-subject-enrollment";
import type { CreateEnrollmentDto } from "./dto/student-subject-enrollment.dto";

function buildPrismaMock() {
  return {
    classArm: { findUniqueOrThrow: jest.fn() },
    classSubject: { findUnique: jest.fn() },
    studentDepartment: { findUnique: jest.fn() },
    studentSubjectEnrollment: { upsert: jest.fn() },
  };
}

function buildTxMock() {
  return {
    classArm: { findUniqueOrThrow: jest.fn() },
    term: { findFirst: jest.fn() },
    classSubject: { findMany: jest.fn() },
    classSubjectTermStatus: { findUnique: jest.fn() },
    studentSubjectEnrollment: { upsert: jest.fn() },
  };
}

function buildClassSubjectTermStatusMock() {
  return { assertActiveForTerm: jest.fn() };
}

const CLASS_ARM = {
  id: "arm-1",
  classLevelId: "level-1",
  classLevel: { category: ClassLevelCategory.JSS },
  academicSessionId: "session-1",
};
const TERM = { id: "term-1", academicSessionId: "session-1", isCurrent: true };

describe("StudentSubjectEnrollmentService.syncCompulsoryEnrollmentsOnClassAssignment (PRD §3.3)", () => {
  let tx: ReturnType<typeof buildTxMock>;
  let service: StudentSubjectEnrollmentService;

  beforeEach(() => {
    tx = buildTxMock();
    service = new StudentSubjectEnrollmentService({} as never, buildClassSubjectTermStatusMock() as never);
    tx.classArm.findUniqueOrThrow.mockResolvedValue(CLASS_ARM);
    tx.term.findFirst.mockResolvedValue(TERM);
    tx.classSubjectTermStatus.findUnique.mockResolvedValue(null);
  });

  it("auto-enrolls a COMPULSORY subject and skips a GENERAL one", async () => {
    tx.classSubject.findMany.mockResolvedValue([
      {
        id: "cs-1",
        subjectId: "subj-compulsory",
        type: SubjectType.COMPULSORY,
        subject: { isActive: true },
      },
      {
        id: "cs-2",
        subjectId: "subj-general",
        type: SubjectType.GENERAL,
        subject: { isActive: true },
      },
    ]);

    await service.syncCompulsoryEnrollmentsOnClassAssignment(tx as never, {
      studentId: "student-1",
      classArmId: "arm-1",
    });

    expect(tx.studentSubjectEnrollment.upsert).toHaveBeenCalledTimes(1);
    expect(tx.studentSubjectEnrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ subjectId: "subj-compulsory", status: EnrollmentStatus.ACTIVE }),
      }),
    );
  });

  it("skips a COMPULSORY subject explicitly disabled for this class+term", async () => {
    tx.classSubject.findMany.mockResolvedValue([
      {
        id: "cs-1",
        subjectId: "subj-compulsory",
        type: SubjectType.COMPULSORY,
        subject: { isActive: true },
      },
    ]);
    tx.classSubjectTermStatus.findUnique.mockResolvedValue({ isActive: false });

    await service.syncCompulsoryEnrollmentsOnClassAssignment(tx as never, {
      studentId: "student-1",
      classArmId: "arm-1",
    });

    expect(tx.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("skips a COMPULSORY subject disabled catalogue-wide (Subject.isActive)", async () => {
    tx.classSubject.findMany.mockResolvedValue([
      {
        id: "cs-1",
        subjectId: "subj-compulsory",
        type: SubjectType.COMPULSORY,
        subject: { isActive: false },
      },
    ]);

    await service.syncCompulsoryEnrollmentsOnClassAssignment(tx as never, {
      studentId: "student-1",
      classArmId: "arm-1",
    });

    expect(tx.classSubjectTermStatus.findUnique).not.toHaveBeenCalled();
    expect(tx.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("no-ops when there is no current term for the session (known Term.isCurrent gap)", async () => {
    tx.term.findFirst.mockResolvedValue(null);

    await service.syncCompulsoryEnrollmentsOnClassAssignment(tx as never, {
      studentId: "student-1",
      classArmId: "arm-1",
    });

    expect(tx.classSubject.findMany).not.toHaveBeenCalled();
    expect(tx.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });
});

describe("StudentSubjectEnrollmentService.enroll (PRD FR2.5, FR2.4)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let classSubjectTermStatus: ReturnType<typeof buildClassSubjectTermStatusMock>;
  let service: StudentSubjectEnrollmentService;

  function buildDto(overrides: Partial<CreateEnrollmentDto> = {}): CreateEnrollmentDto {
    return {
      studentId: "student-1",
      subjectId: "subj-1",
      classArmId: "arm-1",
      academicSessionId: "session-1",
      termId: "term-1",
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = buildPrismaMock();
    classSubjectTermStatus = buildClassSubjectTermStatusMock();
    service = new StudentSubjectEnrollmentService(prisma as never, classSubjectTermStatus as never);
    prisma.classArm.findUniqueOrThrow.mockResolvedValue({
      ...CLASS_ARM,
      classLevel: { category: ClassLevelCategory.SSS },
    });
  });

  it("allows GENERAL opt-in without any department check", async () => {
    prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.GENERAL, departmentId: null });

    await service.enroll(buildDto());

    expect(prisma.studentDepartment.findUnique).not.toHaveBeenCalled();
    expect(prisma.studentSubjectEnrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: EnrollmentStatus.ACTIVE }) }),
    );
  });

  it("rejects manual enroll into an effectively-compulsory subject", async () => {
    prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.COMPULSORY, departmentId: null });

    await expect(service.enroll(buildDto())).rejects.toThrow(/auto-enroll/);
    expect(prisma.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("rejects a DEPARTMENT subject for a non-SSS class level", async () => {
    prisma.classArm.findUniqueOrThrow.mockResolvedValue({
      ...CLASS_ARM,
      classLevel: { category: ClassLevelCategory.JSS },
    });
    prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.DEPARTMENT, departmentId: "dept-science" });

    await expect(service.enroll(buildDto())).rejects.toThrow(/SSS/);
  });

  it("rejects a DEPARTMENT subject when the student's department doesn't match", async () => {
    prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.DEPARTMENT, departmentId: "dept-science" });
    prisma.studentDepartment.findUnique.mockResolvedValue({ departmentId: "dept-commercial" });

    await expect(service.enroll(buildDto())).rejects.toThrow(/department/);
    expect(prisma.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("allows a DEPARTMENT subject when the student's department matches", async () => {
    prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.DEPARTMENT, departmentId: "dept-science" });
    prisma.studentDepartment.findUnique.mockResolvedValue({ departmentId: "dept-science" });

    await service.enroll(buildDto());

    expect(prisma.studentSubjectEnrollment.upsert).toHaveBeenCalledTimes(1);
  });

  it("rejects when the subject isn't assigned to that class this session", async () => {
    prisma.classSubject.findUnique.mockResolvedValue(null);

    await expect(service.enroll(buildDto())).rejects.toThrow(/not assigned/);
  });

  it("blocks opt-in when the subject is disabled for this class+term", async () => {
    prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.GENERAL, departmentId: null });
    classSubjectTermStatus.assertActiveForTerm.mockRejectedValue(new Error("disabled for this class for this term"));

    await expect(service.enroll(buildDto())).rejects.toThrow(/disabled for this class for this term/);
    expect(prisma.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });
});
