import { ClassLevelCategory, EnrollmentStatus, SubjectType } from "@prisma/client";
import { StudentSubjectEnrollmentService } from "./student-subject-enrollment";
import type { CreateEnrollmentDto } from "./dto/student-subject-enrollment.dto";
import type { RequestUser } from "../auth/jwt.strategy";

function buildPrismaMock() {
  const prisma = {
    classArm: { findUniqueOrThrow: jest.fn() },
    classSubject: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    classSubjectTermStatus: { findUnique: jest.fn() },
    classSubjectLevelStatus: { findUnique: jest.fn() },
    studentDepartment: { findUnique: jest.fn() },
    studentProfile: { findMany: jest.fn(), findUnique: jest.fn() },
    studentSubjectEnrollment: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    studentSubjectExemption: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    subjectTermResult: { deleteMany: jest.fn() },
    termReportCard: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    staffProfile: { findUnique: jest.fn() },
    staffAssignment: { findMany: jest.fn(), count: jest.fn() },
    parentProfile: { findUnique: jest.fn() },
    term: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  // Interactive transaction: run the callback against the same mock.
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return prisma;
}

function buildTxMock() {
  return {
    classArm: { findUniqueOrThrow: jest.fn() },
    term: { findFirst: jest.fn() },
    classSubject: { findMany: jest.fn() },
    classSubjectTermStatus: { findUnique: jest.fn() },
    classSubjectLevelStatus: { findUnique: jest.fn() },
    studentSubjectEnrollment: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    studentSubjectExemption: { findMany: jest.fn().mockResolvedValue([]) },
    subjectTermResult: { deleteMany: jest.fn() },
  };
}

function buildClassSubjectTermStatusMock() {
  return { assertActiveForTerm: jest.fn() };
}

function buildClassSubjectLevelStatusMock() {
  return { assertActiveForClassLevel: jest.fn() };
}

function buildRecomputeQueueMock() {
  return { add: jest.fn() };
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
    service = new StudentSubjectEnrollmentService(
      {} as never,
      buildClassSubjectTermStatusMock() as never,
      buildClassSubjectLevelStatusMock() as never,
      buildRecomputeQueueMock() as never,
    );
    tx.classArm.findUniqueOrThrow.mockResolvedValue(CLASS_ARM);
    tx.term.findFirst.mockResolvedValue(TERM);
    tx.classSubjectTermStatus.findUnique.mockResolvedValue(null);
    tx.classSubjectLevelStatus.findUnique.mockResolvedValue(null);
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

  it("moves a leftover enrollment to the new arm when the subject still applies to the new class", async () => {
    tx.classSubject.findMany.mockResolvedValue([
      { id: "cs-2", subjectId: "subj-general", type: SubjectType.GENERAL, subject: { isActive: true } },
    ]);
    tx.studentSubjectEnrollment.findMany.mockResolvedValue([
      { id: "enr-1", subjectId: "subj-general", classArmId: "old-arm", subject: { childSubjects: [] } },
    ]);

    await service.syncCompulsoryEnrollmentsOnClassAssignment(tx as never, { studentId: "student-1", classArmId: "arm-1" });

    expect(tx.studentSubjectEnrollment.update).toHaveBeenCalledWith({ where: { id: "enr-1" }, data: { classArmId: "arm-1" } });
    expect(tx.subjectTermResult.deleteMany).not.toHaveBeenCalled();
  });

  it("drops a leftover enrollment (and its term results) when the subject doesn't apply to the new class", async () => {
    tx.classSubject.findMany.mockResolvedValue([]);
    tx.studentSubjectEnrollment.findMany.mockResolvedValue([
      { id: "enr-1", subjectId: "group-old", classArmId: "old-arm", subject: { childSubjects: [{ id: "child-old" }] } },
    ]);

    await service.syncCompulsoryEnrollmentsOnClassAssignment(tx as never, { studentId: "student-1", classArmId: "arm-1" });

    expect(tx.studentSubjectEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId: "student-1", termId: "term-1", status: EnrollmentStatus.ACTIVE, classArmId: { not: "arm-1" } },
      }),
    );
    expect(tx.studentSubjectEnrollment.update).toHaveBeenCalledWith({
      where: { id: "enr-1" },
      data: { status: EnrollmentStatus.DROPPED },
    });
    expect(tx.subjectTermResult.deleteMany).toHaveBeenCalledWith({
      where: { studentId: "student-1", termId: "term-1", classArmId: "old-arm", subjectId: { in: ["group-old", "child-old"] } },
    });
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

  it("skips a COMPULSORY subject explicitly disabled for this specific class level", async () => {
    tx.classSubject.findMany.mockResolvedValue([
      {
        id: "cs-1",
        subjectId: "subj-compulsory",
        type: SubjectType.COMPULSORY,
        subject: { isActive: true },
      },
    ]);
    tx.classSubjectLevelStatus.findUnique.mockResolvedValue({ isActive: false });

    await service.syncCompulsoryEnrollmentsOnClassAssignment(tx as never, {
      studentId: "student-1",
      classArmId: "arm-1",
    });

    expect(tx.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("skips a COMPULSORY subject the student is exempted from (StudentSubjectExemption)", async () => {
    tx.classSubject.findMany.mockResolvedValue([
      { id: "cs-1", subjectId: "subj-crs", type: SubjectType.COMPULSORY, subject: { isActive: true } },
      { id: "cs-2", subjectId: "subj-maths", type: SubjectType.COMPULSORY, subject: { isActive: true } },
    ]);
    tx.studentSubjectExemption.findMany.mockResolvedValue([{ subjectId: "subj-crs" }]);

    await service.syncCompulsoryEnrollmentsOnClassAssignment(tx as never, {
      studentId: "student-1",
      classArmId: "arm-1",
    });

    expect(tx.studentSubjectExemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId: "student-1" } }),
    );
    expect(tx.studentSubjectEnrollment.upsert).toHaveBeenCalledTimes(1);
    expect(tx.studentSubjectEnrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ subjectId: "subj-maths" }) }),
    );
  });
});

// Regression: JSS 1's CCA/Yoruba/French report-card bug — a ClassSubject
// flipped to COMPULSORY after students were already assigned to that class
// category never backfilled them, since syncCompulsoryEnrollmentsOnClassAssignment
// only runs at class-assignment time. This is ClassSubjectService.create/
// update's hook to close that gap.
describe("StudentSubjectEnrollmentService.syncEnrollmentsForClassSubject", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let recomputeQueue: ReturnType<typeof buildRecomputeQueueMock>;
  let service: StudentSubjectEnrollmentService;

  const CLASS_SUBJECT = {
    id: "cs-1",
    classLevelCategory: ClassLevelCategory.JSS,
    subjectId: "subj-cca",
    type: SubjectType.COMPULSORY,
    subject: { isActive: true },
  };
  const STUDENT = {
    id: "student-1",
    currentClass: { id: "arm-1", classLevelId: "level-1", academicSessionId: "session-1" },
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    recomputeQueue = buildRecomputeQueueMock();
    service = new StudentSubjectEnrollmentService(
      prisma as never,
      buildClassSubjectTermStatusMock() as never,
      buildClassSubjectLevelStatusMock() as never,
      recomputeQueue as never,
    );
    prisma.classSubject.findUniqueOrThrow.mockResolvedValue(CLASS_SUBJECT);
    prisma.studentProfile.findMany.mockResolvedValue([STUDENT]);
    prisma.term.findFirst.mockResolvedValue(TERM);
    prisma.classSubjectTermStatus.findUnique.mockResolvedValue(null);
    prisma.classSubjectLevelStatus.findUnique.mockResolvedValue(null);
  });

  it("backfills every student currently in the class category and queues a recompute", async () => {
    await service.syncEnrollmentsForClassSubject("cs-1");

    expect(prisma.studentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "ACTIVE", currentClass: { classLevel: { category: ClassLevelCategory.JSS } } },
      }),
    );
    expect(prisma.studentSubjectEnrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          studentId: "student-1",
          subjectId: "subj-cca",
          classArmId: "arm-1",
          academicSessionId: "session-1",
          termId: "term-1",
          status: EnrollmentStatus.ACTIVE,
        }),
      }),
    );
    expect(recomputeQueue.add).toHaveBeenCalledWith("recompute", {
      studentId: "student-1",
      subjectId: "subj-cca",
      classArmId: "arm-1",
      termId: "term-1",
    });
  });

  it("no-ops when the ClassSubject isn't COMPULSORY", async () => {
    prisma.classSubject.findUniqueOrThrow.mockResolvedValue({ ...CLASS_SUBJECT, type: SubjectType.GENERAL });

    await service.syncEnrollmentsForClassSubject("cs-1");

    expect(prisma.studentProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("no-ops when the subject is disabled catalogue-wide (Subject.isActive)", async () => {
    prisma.classSubject.findUniqueOrThrow.mockResolvedValue({ ...CLASS_SUBJECT, subject: { isActive: false } });

    await service.syncEnrollmentsForClassSubject("cs-1");

    expect(prisma.studentProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("skips a student whose session has no current term (known Term.isCurrent gap)", async () => {
    prisma.term.findFirst.mockResolvedValue(null);

    await service.syncEnrollmentsForClassSubject("cs-1");

    expect(prisma.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
    expect(recomputeQueue.add).not.toHaveBeenCalled();
  });

  it("skips a student whose enrollment is dropped by a per-term ClassSubjectTermStatus", async () => {
    prisma.classSubjectTermStatus.findUnique.mockResolvedValue({ isActive: false });

    await service.syncEnrollmentsForClassSubject("cs-1");

    expect(prisma.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("skips a student whose enrollment is dropped by a per-class-level ClassSubjectLevelStatus", async () => {
    prisma.classSubjectLevelStatus.findUnique.mockResolvedValue({ isActive: false });

    await service.syncEnrollmentsForClassSubject("cs-1");

    expect(prisma.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("backfills every affected student when more than one is in the category", async () => {
    prisma.studentProfile.findMany.mockResolvedValue([
      STUDENT,
      { id: "student-2", currentClass: { id: "arm-1", classLevelId: "level-1", academicSessionId: "session-1" } },
    ]);

    await service.syncEnrollmentsForClassSubject("cs-1");

    expect(prisma.studentSubjectEnrollment.upsert).toHaveBeenCalledTimes(2);
    expect(recomputeQueue.add).toHaveBeenCalledTimes(2);
  });

  it("skips a student exempted from this subject, without touching the others", async () => {
    prisma.studentProfile.findMany.mockResolvedValue([
      STUDENT,
      { id: "student-2", currentClass: { id: "arm-1", classLevelId: "level-1", academicSessionId: "session-1" } },
    ]);
    prisma.studentSubjectExemption.findMany.mockResolvedValue([{ studentId: "student-1" }]);

    await service.syncEnrollmentsForClassSubject("cs-1");

    expect(prisma.studentSubjectExemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { subjectId: "subj-cca" } }),
    );
    expect(prisma.studentSubjectEnrollment.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.studentSubjectEnrollment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ studentId: "student-2" }) }),
    );
  });
});

describe("StudentSubjectEnrollmentService.enroll (PRD FR2.5, FR2.4)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let classSubjectTermStatus: ReturnType<typeof buildClassSubjectTermStatusMock>;
  let classSubjectLevelStatus: ReturnType<typeof buildClassSubjectLevelStatusMock>;
  let recomputeQueue: ReturnType<typeof buildRecomputeQueueMock>;
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
    classSubjectLevelStatus = buildClassSubjectLevelStatusMock();
    recomputeQueue = buildRecomputeQueueMock();
    service = new StudentSubjectEnrollmentService(
      prisma as never,
      classSubjectTermStatus as never,
      classSubjectLevelStatus as never,
      recomputeQueue as never,
    );
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
    expect(recomputeQueue.add).toHaveBeenCalledWith("recompute", {
      studentId: "student-1",
      subjectId: "subj-1",
      classArmId: "arm-1",
      termId: "term-1",
    });
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

  it("blocks opt-in when the subject is disabled for this specific class level", async () => {
    prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.GENERAL, departmentId: null });
    classSubjectLevelStatus.assertActiveForClassLevel.mockRejectedValue(new Error("disabled for this class level"));

    await expect(service.enroll(buildDto())).rejects.toThrow(/disabled for this class level/);
    expect(prisma.studentSubjectEnrollment.upsert).not.toHaveBeenCalled();
  });
});

// The GET endpoint behind the student profile page's "Subjects" section —
// visibility must match StudentService.findOneForUser exactly (same
// canAccessStudent choke point) so a user who can't open the profile can't
// read its subjects either via a direct API call.
describe("StudentSubjectEnrollmentService.findForStudentAsUser", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: StudentSubjectEnrollmentService;

  const STUDENT_IN_JSS = {
    userId: "student-user-1",
    status: "ACTIVE",
    currentClassId: "arm-1",
    currentClass: { classLevel: { category: ClassLevelCategory.JSS } },
    guardians: [],
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new StudentSubjectEnrollmentService(
      prisma as never,
      buildClassSubjectTermStatusMock() as never,
      buildClassSubjectLevelStatusMock() as never,
      buildRecomputeQueueMock() as never,
    );
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([]);
  });

  function staffUser(assignmentTypes: string[] = []): RequestUser {
    return { id: "user-1", roles: ["STAFF"], assignmentTypes };
  }

  it("throws NotFoundException when the student doesn't exist", async () => {
    prisma.studentProfile.findUnique.mockResolvedValue(null);

    await expect(service.findForStudentAsUser("missing", {}, staffUser())).rejects.toThrow(/not found/i);
  });

  it("lets ADMIN read any student's enrollments without a scoping check", async () => {
    prisma.studentProfile.findUnique.mockResolvedValue(STUDENT_IN_JSS);
    const adminUser: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };

    await service.findForStudentAsUser("student-1", {}, adminUser);

    expect(prisma.staffProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.studentSubjectEnrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ studentId: "student-1" }) }),
    );
  });

  it("allows a PRINCIPAL to read a JSS student's enrollments (category-scoped, no DB round trip)", async () => {
    prisma.studentProfile.findUnique.mockResolvedValue(STUDENT_IN_JSS);

    await service.findForStudentAsUser("student-1", {}, staffUser(["PRINCIPAL"]));

    expect(prisma.studentSubjectEnrollment.findMany).toHaveBeenCalled();
  });

  it("blocks a HEADTEACHER from reading a JSS student's enrollments (out of their Creche-Primary section)", async () => {
    prisma.studentProfile.findUnique.mockResolvedValue(STUDENT_IN_JSS);

    await expect(service.findForStudentAsUser("student-1", {}, staffUser(["HEADTEACHER"]))).rejects.toThrow(
      /insufficient permissions/i,
    );
    expect(prisma.studentSubjectEnrollment.findMany).not.toHaveBeenCalled();
  });

  it("allows a CLASS_TEACHER assigned to the student's own class arm", async () => {
    prisma.studentProfile.findUnique.mockResolvedValue(STUDENT_IN_JSS);
    prisma.staffAssignment.count.mockResolvedValue(0); // no REGISTRAR/BURSAR
    prisma.staffProfile.findUnique.mockResolvedValue({ id: "staff-1" });
    prisma.staffAssignment.findMany.mockResolvedValue([{ classArmId: "arm-1" }]);

    await service.findForStudentAsUser("student-1", {}, staffUser());

    expect(prisma.studentSubjectEnrollment.findMany).toHaveBeenCalled();
  });

  it("blocks a class teacher assigned to a different class arm", async () => {
    prisma.studentProfile.findUnique.mockResolvedValue(STUDENT_IN_JSS);
    prisma.staffAssignment.count.mockResolvedValue(0);
    prisma.staffProfile.findUnique.mockResolvedValue({ id: "staff-1" });
    prisma.staffAssignment.findMany.mockResolvedValue([{ classArmId: "arm-other" }]);

    await expect(service.findForStudentAsUser("student-1", {}, staffUser())).rejects.toThrow(
      /insufficient permissions/i,
    );
  });

  it("allows a REGISTRAR (school-wide staff assignment) regardless of class", async () => {
    prisma.studentProfile.findUnique.mockResolvedValue(STUDENT_IN_JSS);
    prisma.staffProfile.findUnique.mockResolvedValue({ id: "staff-1" });
    prisma.staffAssignment.count.mockResolvedValue(1); // active REGISTRAR/BURSAR assignment

    await service.findForStudentAsUser("student-1", {}, staffUser());

    expect(prisma.studentSubjectEnrollment.findMany).toHaveBeenCalled();
  });

  it("blocks a PARENT who isn't this student's guardian", async () => {
    prisma.studentProfile.findUnique.mockResolvedValue(STUDENT_IN_JSS);
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-1" });
    const parentUser: RequestUser = { id: "user-2", roles: ["PARENT"], assignmentTypes: [] };

    await expect(service.findForStudentAsUser("student-1", {}, parentUser)).rejects.toThrow(
      /insufficient permissions/i,
    );
  });
});

describe("StudentSubjectEnrollmentService.drop / restore (per-student compulsory exemption)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let classSubjectTermStatus: ReturnType<typeof buildClassSubjectTermStatusMock>;
  let classSubjectLevelStatus: ReturnType<typeof buildClassSubjectLevelStatusMock>;
  let recomputeQueue: ReturnType<typeof buildRecomputeQueueMock>;
  let service: StudentSubjectEnrollmentService;

  const ROW = {
    id: "enr-1",
    studentId: "student-1",
    subjectId: "subj-crs",
    classArmId: "arm-1",
    academicSessionId: "session-1",
    termId: "term-1",
    status: EnrollmentStatus.ACTIVE,
  };

  beforeEach(() => {
    prisma = buildPrismaMock();
    classSubjectTermStatus = buildClassSubjectTermStatusMock();
    classSubjectLevelStatus = buildClassSubjectLevelStatusMock();
    recomputeQueue = buildRecomputeQueueMock();
    service = new StudentSubjectEnrollmentService(
      prisma as never,
      classSubjectTermStatus as never,
      classSubjectLevelStatus as never,
      recomputeQueue as never,
    );
    prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({
      ...ROW,
      classArm: CLASS_ARM,
      subject: { childSubjects: [] },
    });
    prisma.studentSubjectEnrollment.update.mockImplementation(({ data }) => Promise.resolve({ ...ROW, ...data }));
  });

  describe("drop", () => {
    it("records an exemption when the dropped subject is COMPULSORY", async () => {
      prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.COMPULSORY });

      const result = await service.drop("enr-1");

      expect(prisma.studentSubjectEnrollment.update).toHaveBeenCalledWith({
        where: { id: "enr-1" },
        data: { status: EnrollmentStatus.DROPPED },
      });
      expect(prisma.studentSubjectExemption.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: { studentId: "student-1", subjectId: "subj-crs" } }),
      );
      expect(result.exempted).toBe(true);
    });

    it("doesn't record an exemption for a GENERAL subject", async () => {
      prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.GENERAL });

      const result = await service.drop("enr-1");

      expect(prisma.studentSubjectExemption.upsert).not.toHaveBeenCalled();
      expect(result.exempted).toBe(false);
    });

    it("flags the term's generated report cards for regeneration and reports how many", async () => {
      prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.COMPULSORY });
      prisma.termReportCard.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.drop("enr-1");

      expect(prisma.termReportCard.updateMany).toHaveBeenCalledWith({
        where: { studentId: "student-1", termId: "term-1", status: { in: ["READY", "PUBLISHED"] } },
        data: expect.objectContaining({ needsRegeneration: true, staleReason: "Subject dropped" }),
      });
      expect(result.reportCardsFlagged).toBe(1);
    });

    it("deletes the subject's (and a group's children's) term results so the full-term report stops listing it", async () => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({
        ...ROW,
        subjectId: "subj-eng",
        classArm: CLASS_ARM,
        subject: { childSubjects: [{ id: "subj-essay" }, { id: "subj-comp" }] },
      });
      prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.COMPULSORY });

      await service.drop("enr-1");

      expect(prisma.subjectTermResult.deleteMany).toHaveBeenCalledWith({
        where: { studentId: "student-1", termId: "term-1", subjectId: { in: ["subj-eng", "subj-essay", "subj-comp"] } },
      });
    });

    it("is a no-op for an already-dropped enrollment", async () => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({
        ...ROW,
        status: EnrollmentStatus.DROPPED,
        classArm: CLASS_ARM,
        subject: { childSubjects: [] },
      });

      await service.drop("enr-1");

      expect(prisma.studentSubjectEnrollment.update).not.toHaveBeenCalled();
      expect(prisma.termReportCard.updateMany).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for an unknown enrollment", async () => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue(null);

      await expect(service.drop("missing")).rejects.toThrow(/not found/i);
    });
  });

  describe("restore", () => {
    beforeEach(() => {
      prisma.studentSubjectEnrollment.findUnique.mockResolvedValue({
        ...ROW,
        status: EnrollmentStatus.DROPPED,
        classArm: CLASS_ARM,
      });
    });

    it("reactivates a COMPULSORY subject, removes the exemption, flags reports and queues a recompute", async () => {
      prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.COMPULSORY });
      prisma.termReportCard.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.restore("enr-1");

      expect(prisma.studentSubjectExemption.deleteMany).toHaveBeenCalledWith({
        where: { studentId: "student-1", subjectId: "subj-crs" },
      });
      expect(prisma.studentSubjectEnrollment.update).toHaveBeenCalledWith({
        where: { id: "enr-1" },
        data: { status: EnrollmentStatus.ACTIVE },
      });
      expect(prisma.termReportCard.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ staleReason: "Subject restored" }) }),
      );
      expect(recomputeQueue.add).toHaveBeenCalledWith("recompute", {
        studentId: "student-1",
        subjectId: "subj-crs",
        classArmId: "arm-1",
        termId: "term-1",
      });
      expect(result.reportCardsFlagged).toBe(1);
    });

    it("still honours the per-term/per-level applicability gates for a COMPULSORY subject", async () => {
      prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.COMPULSORY });
      classSubjectLevelStatus.assertActiveForClassLevel.mockRejectedValue(new Error("disabled for this class level"));

      await expect(service.restore("enr-1")).rejects.toThrow(/disabled/);
      expect(prisma.studentSubjectEnrollment.update).not.toHaveBeenCalled();
      expect(prisma.studentSubjectExemption.deleteMany).not.toHaveBeenCalled();
    });

    it("routes a GENERAL subject through enroll() and flags reports", async () => {
      prisma.classSubject.findUnique.mockResolvedValue({ type: SubjectType.GENERAL, departmentId: null });
      prisma.classArm.findUniqueOrThrow.mockResolvedValue(CLASS_ARM);
      prisma.studentSubjectEnrollment.upsert.mockResolvedValue({ ...ROW, status: EnrollmentStatus.ACTIVE });

      await service.restore("enr-1");

      expect(prisma.studentSubjectEnrollment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { status: EnrollmentStatus.ACTIVE, classArmId: "arm-1" } }),
      );
      expect(prisma.studentSubjectExemption.deleteMany).not.toHaveBeenCalled();
      expect(prisma.termReportCard.updateMany).toHaveBeenCalled();
    });

    it("rejects when the subject is no longer assigned to the class", async () => {
      prisma.classSubject.findUnique.mockResolvedValue(null);

      await expect(service.restore("enr-1")).rejects.toThrow(/no longer assigned/i);
    });
  });

  it("findForStudent marks a dropped enrollment with an exemption as exempt (and only that one)", async () => {
    prisma.studentSubjectEnrollment.findMany.mockResolvedValue([
      { ...ROW, status: EnrollmentStatus.DROPPED },
      { ...ROW, id: "enr-2", subjectId: "subj-art", status: EnrollmentStatus.DROPPED },
      { ...ROW, id: "enr-3", subjectId: "subj-maths" },
    ]);
    prisma.studentSubjectExemption.findMany.mockResolvedValue([{ subjectId: "subj-crs" }]);

    const rows = await service.findForStudent("student-1", {});

    expect(rows.map((r) => [r.id, r.exempt])).toEqual([
      ["enr-1", true],
      ["enr-2", false],
      ["enr-3", false],
    ]);
  });
});
