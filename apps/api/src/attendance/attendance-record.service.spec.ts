import { AttendanceRecordService } from "./attendance-record";
import { AbilityFactory } from "../casl/ability.factory";
import type { RequestUser } from "../auth/jwt.strategy";

const abilityFactory = new AbilityFactory();

const ADMIN: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };
const REGISTRAR: RequestUser = { id: "registrar-1", roles: ["STAFF"], assignmentTypes: ["REGISTRAR"] };
const CLASS_TEACHER: RequestUser = { id: "teacher-1", roles: ["STAFF"], assignmentTypes: ["CLASS_TEACHER"] };
const PLAIN_STAFF: RequestUser = { id: "staff-3", roles: ["STAFF"], assignmentTypes: [] };

const RECENT_DATE = new Date();

function buildStudentDailySession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    type: "STUDENT",
    kind: "DAILY",
    classArmId: "arm-1",
    subjectId: null,
    date: RECENT_DATE,
    ...overrides,
  };
}

function buildPrismaMock(session = buildStudentDailySession()) {
  return {
    attendanceRecord: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "record-1", attendanceSession: session }),
      update: jest.fn().mockResolvedValue({ id: "record-1", status: "ABSENT" }),
    },
  };
}

function buildStaffAssignmentsMock() {
  return { findActiveAssignment: jest.fn() };
}

function buildSchoolProfileMock() {
  return { get: jest.fn().mockResolvedValue({ attendanceBackdateWindowDays: 3 }) };
}

describe("AttendanceRecordService.update", () => {
  it("allows the class teacher to correct a record in her own recent session", async () => {
    const prisma = buildPrismaMock();
    const staffAssignments = buildStaffAssignmentsMock();
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    const schoolProfile = buildSchoolProfileMock();
    const service = new AttendanceRecordService(prisma as never, staffAssignments as never, schoolProfile as never);
    const ability = abilityFactory.createForUser(CLASS_TEACHER);

    await service.update("record-1", { status: "ABSENT" }, CLASS_TEACHER, ability);

    expect(staffAssignments.findActiveAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentType: "CLASS_TEACHER", classArmId: "arm-1" }),
    );
    expect(prisma.attendanceRecord.update).toHaveBeenCalledWith({
      where: { id: "record-1" },
      data: { status: "ABSENT" },
    });
  });

  it("rejects a class teacher with no active assignment for the session's class", async () => {
    const prisma = buildPrismaMock();
    const staffAssignments = buildStaffAssignmentsMock();
    staffAssignments.findActiveAssignment.mockResolvedValue(null);
    const schoolProfile = buildSchoolProfileMock();
    const service = new AttendanceRecordService(prisma as never, staffAssignments as never, schoolProfile as never);
    const ability = abilityFactory.createForUser(CLASS_TEACHER);

    await expect(service.update("record-1", { status: "ABSENT" }, CLASS_TEACHER, ability)).rejects.toThrow(
      /not the class teacher/,
    );
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
  });

  it("rejects correcting a record once the session is older than the back-date window, without override", async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const prisma = buildPrismaMock(buildStudentDailySession({ date: oldDate }));
    const staffAssignments = buildStaffAssignmentsMock();
    staffAssignments.findActiveAssignment.mockResolvedValue({ id: "assignment-1", staffId: "staff-1" });
    const schoolProfile = buildSchoolProfileMock();
    const service = new AttendanceRecordService(prisma as never, staffAssignments as never, schoolProfile as never);
    const ability = abilityFactory.createForUser(CLASS_TEACHER);

    await expect(service.update("record-1", { status: "ABSENT" }, CLASS_TEACHER, ability)).rejects.toThrow(
      /Admin override/,
    );
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
  });

  it("rejects a Registrar correcting a STUDENT-type session record she's not the class teacher of (regression: bare-string override check must not leak Registrar's STAFF-scoped grant)", async () => {
    const prisma = buildPrismaMock();
    const staffAssignments = buildStaffAssignmentsMock();
    staffAssignments.findActiveAssignment.mockResolvedValue(null);
    const schoolProfile = buildSchoolProfileMock();
    const service = new AttendanceRecordService(prisma as never, staffAssignments as never, schoolProfile as never);
    const ability = abilityFactory.createForUser(REGISTRAR);

    await expect(service.update("record-1", { status: "ABSENT" }, REGISTRAR, ability)).rejects.toThrow(
      /not the class teacher/,
    );
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
  });

  it("allows Admin override to correct a record regardless of age or assignment", async () => {
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const prisma = buildPrismaMock(buildStudentDailySession({ date: oldDate }));
    const staffAssignments = buildStaffAssignmentsMock();
    const schoolProfile = buildSchoolProfileMock();
    const service = new AttendanceRecordService(prisma as never, staffAssignments as never, schoolProfile as never);
    const ability = abilityFactory.createForUser(ADMIN);

    await service.update("record-1", { status: "ABSENT" }, ADMIN, ability);

    expect(staffAssignments.findActiveAssignment).not.toHaveBeenCalled();
    expect(schoolProfile.get).not.toHaveBeenCalled();
    expect(prisma.attendanceRecord.update).toHaveBeenCalled();
  });

  it("allows a Registrar to correct a STAFF-type session record", async () => {
    const prisma = buildPrismaMock(buildStudentDailySession({ type: "STAFF", classArmId: null, kind: "DAILY" }));
    const staffAssignments = buildStaffAssignmentsMock();
    const schoolProfile = buildSchoolProfileMock();
    const service = new AttendanceRecordService(prisma as never, staffAssignments as never, schoolProfile as never);
    const ability = abilityFactory.createForUser(REGISTRAR);

    await service.update("record-1", { status: "LATE" }, REGISTRAR, ability);

    expect(prisma.attendanceRecord.update).toHaveBeenCalled();
  });

  it("rejects a plain staff member correcting a STAFF-type session record", async () => {
    const prisma = buildPrismaMock(buildStudentDailySession({ type: "STAFF", classArmId: null, kind: "DAILY" }));
    const staffAssignments = buildStaffAssignmentsMock();
    const schoolProfile = buildSchoolProfileMock();
    const service = new AttendanceRecordService(prisma as never, staffAssignments as never, schoolProfile as never);
    const ability = abilityFactory.createForUser(PLAIN_STAFF);

    await expect(service.update("record-1", { status: "LATE" }, PLAIN_STAFF, ability)).rejects.toThrow(
      /not permitted to correct staff attendance/,
    );
    expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
  });
});
