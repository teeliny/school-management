import { AttendanceSessionService } from "./attendance-session";
import { AbilityFactory } from "../casl/ability.factory";
import type { RequestUser } from "../auth/jwt.strategy";
import type { CreateAttendanceSessionDto } from "./dto/attendance-session.dto";

const abilityFactory = new AbilityFactory();

const ADMIN: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };
const REGISTRAR: RequestUser = { id: "registrar-1", roles: ["STAFF"], assignmentTypes: ["REGISTRAR"] };
const CLASS_TEACHER: RequestUser = { id: "teacher-1", roles: ["STAFF"], assignmentTypes: ["CLASS_TEACHER"] };
const SUBJECT_TEACHER: RequestUser = { id: "teacher-2", roles: ["STAFF"], assignmentTypes: ["SUBJECT_TEACHER"] };
const PLAIN_STAFF: RequestUser = { id: "staff-3", roles: ["STAFF"], assignmentTypes: [] };

function buildPrismaMock() {
  const tx = {
    attendanceSession: {
      create: jest.fn().mockResolvedValue({ id: "session-1" }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "session-1" }),
    },
    attendanceRecord: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  return {
    staffProfile: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    studentProfile: { findMany: jest.fn().mockResolvedValue([{ id: "student-1" }]) },
    attendanceSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "session-1" }),
    },
    $transaction: jest.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    __tx: tx,
  };
}

function buildStaffAssignmentsMock() {
  return { findActiveAssignment: jest.fn(), activeAssignedClassArmIds: jest.fn() };
}

function buildSchoolProfileMock() {
  return { get: jest.fn().mockResolvedValue({ attendanceBackdateWindowDays: 3, attendanceGranularity: "DAILY" }) };
}

function buildStudentDailyDto(overrides: Partial<CreateAttendanceSessionDto> = {}): CreateAttendanceSessionDto {
  return {
    type: "STUDENT",
    kind: "DAILY",
    classArmId: "arm-1",
    date: new Date(),
    records: [{ personId: "student-1", status: "PRESENT" }],
    ...overrides,
  } as CreateAttendanceSessionDto;
}

describe("AttendanceSessionService.create (PRD §3.7/§6.5 FR5.1/FR5.2)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let staffAssignments: ReturnType<typeof buildStaffAssignmentsMock>;
  let schoolProfile: ReturnType<typeof buildSchoolProfileMock>;
  let service: AttendanceSessionService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    staffAssignments = buildStaffAssignmentsMock();
    schoolProfile = buildSchoolProfileMock();
    service = new AttendanceSessionService(prisma as never, staffAssignments as never, schoolProfile as never);
  });

  it("allows the class teacher to record daily attendance for her own class", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    const ability = abilityFactory.createForUser(CLASS_TEACHER);

    await service.create(buildStudentDailyDto(), CLASS_TEACHER, ability);

    expect(staffAssignments.findActiveAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: CLASS_TEACHER.id, assignmentType: "CLASS_TEACHER", classArmId: "arm-1" }),
    );
    expect(prisma.__tx.attendanceSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ takenByStaffId: "staff-1" }) }),
    );
    expect(prisma.__tx.attendanceRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ personId: "student-1", personType: "STUDENT", attendanceSessionId: "session-1" })],
      }),
    );
  });

  it("rejects a class teacher with no active assignment for this class", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue(null);
    const ability = abilityFactory.createForUser(CLASS_TEACHER);

    await expect(service.create(buildStudentDailyDto(), CLASS_TEACHER, ability)).rejects.toThrow(/not the class teacher/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("scopes a PERIOD-kind session to the assigned subject teacher", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-2" });
    const ability = abilityFactory.createForUser(SUBJECT_TEACHER);

    await service.create(
      buildStudentDailyDto({ kind: "PERIOD", subjectId: "subj-1", period: "P3" }),
      SUBJECT_TEACHER,
      ability,
    );

    expect(staffAssignments.findActiveAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentType: "SUBJECT_TEACHER", classArmId: "arm-1", subjectId: "subj-1" }),
    );
  });

  it("rejects a back-dated session past the configurable window for a non-override user", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const ability = abilityFactory.createForUser(CLASS_TEACHER);

    await expect(service.create(buildStudentDailyDto({ date: tenDaysAgo }), CLASS_TEACHER, ability)).rejects.toThrow(
      /Admin override/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows Admin override to back-date a session and bypasses the class-teacher assignment check", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const ability = abilityFactory.createForUser(ADMIN);

    await service.create(buildStudentDailyDto({ date: tenDaysAgo }), ADMIN, ability);

    expect(staffAssignments.findActiveAssignment).not.toHaveBeenCalled();
    expect(schoolProfile.get).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("rejects a plain staff member (no REGISTRAR assignment) recording STAFF-type attendance", async () => {
    const ability = abilityFactory.createForUser(PLAIN_STAFF);
    const dto = buildStudentDailyDto({ type: "STAFF", classArmId: undefined, records: [{ personId: "staff-9", status: "PRESENT" }] });

    await expect(service.create(dto, PLAIN_STAFF, ability)).rejects.toThrow(/not permitted to record staff attendance/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows a Registrar to record STAFF-type attendance", async () => {
    prisma.staffProfile.findMany.mockResolvedValue([{ id: "staff-9" }]);
    const ability = abilityFactory.createForUser(REGISTRAR);
    const dto = buildStudentDailyDto({ type: "STAFF", classArmId: undefined, records: [{ personId: "staff-9", status: "PRESENT" }] });

    await service.create(dto, REGISTRAR, ability);

    expect(prisma.__tx.attendanceRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ personType: "STAFF" })] }),
    );
  });

  it("rejects a Registrar creating a STUDENT-type session for a class she's not the class teacher of (regression: bare-string override check must not leak Registrar's STAFF-scoped grant)", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue(null);
    const ability = abilityFactory.createForUser(REGISTRAR);

    await expect(service.create(buildStudentDailyDto(), REGISTRAR, ability)).rejects.toThrow(/not the class teacher/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a duplicate session for the same class/date/period", async () => {
    prisma.attendanceSession.findFirst.mockResolvedValue({ id: "existing" });
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    const ability = abilityFactory.createForUser(CLASS_TEACHER);

    await expect(service.create(buildStudentDailyDto(), CLASS_TEACHER, ability)).rejects.toThrow(/already exists/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a record for a student not active in the target class", async () => {
    prisma.studentProfile.findMany.mockResolvedValue([]);
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    const ability = abilityFactory.createForUser(CLASS_TEACHER);

    await expect(service.create(buildStudentDailyDto(), CLASS_TEACHER, ability)).rejects.toThrow(/not active in this class/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a duplicate personId within the submitted records", async () => {
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    const ability = abilityFactory.createForUser(CLASS_TEACHER);
    const dto = buildStudentDailyDto({
      records: [
        { personId: "student-1", status: "PRESENT" },
        { personId: "student-1", status: "ABSENT" },
      ],
    });

    await expect(service.create(dto, CLASS_TEACHER, ability)).rejects.toThrow(/Duplicate personId/);
  });

  it("rejects a STUDENT-type session with no classArmId", async () => {
    const ability = abilityFactory.createForUser(CLASS_TEACHER);

    await expect(
      service.create(buildStudentDailyDto({ classArmId: undefined }), CLASS_TEACHER, ability),
    ).rejects.toThrow(/classArmId is required/);
  });

  it("rejects a PERIOD-kind session with no subjectId", async () => {
    const ability = abilityFactory.createForUser(SUBJECT_TEACHER);

    await expect(service.create(buildStudentDailyDto({ kind: "PERIOD" }), SUBJECT_TEACHER, ability)).rejects.toThrow(
      /subjectId is required/,
    );
  });
});
