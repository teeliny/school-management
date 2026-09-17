import { ClassLevelCategory, DayOfWeek, TimetableApprovalStatus, TimetableGeneratedBy } from "@prisma/client";
import { TimetableSlotService } from "./timetable-slot";
import type { CreateTimetableSlotDto } from "./dto/timetable-slot.dto";

function buildPrismaMock() {
  return {
    timetableSlot: {
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    classArm: {
      findUnique: jest.fn(),
    },
    subject: {
      findUnique: jest.fn(),
    },
    schedulingConstraint: {
      findFirst: jest.fn(),
    },
  };
}

function buildDto(overrides: Partial<CreateTimetableSlotDto> = {}): CreateTimetableSlotDto {
  return {
    classArmId: "arm-1",
    subjectId: "subj-1",
    staffId: "staff-1",
    academicSessionId: "session-1",
    termId: "term-1",
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: "08:00",
    endTime: "08:40",
    ...overrides,
  };
}

// PRD §3.8: teacher/venue double-booking conflicts are a service-layer range
// check, "regardless of origin" — these tests exercise that check directly.
describe("TimetableSlotService — double-booking conflicts", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: TimetableSlotService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new TimetableSlotService(prisma as never);
  });

  it("rejects a second slot for the same teacher with an overlapping time range", async () => {
    prisma.timetableSlot.findMany.mockResolvedValueOnce([
      { id: "existing-1", startTime: "08:00", endTime: "08:40" },
    ]);

    await expect(service.create(buildDto({ startTime: "08:20", endTime: "09:00" }), "user-1")).rejects.toThrow(
      /Teacher is already booked/,
    );
    expect(prisma.timetableSlot.create).not.toHaveBeenCalled();
  });

  it("allows back-to-back (touching) times for the same teacher — not an overlap", async () => {
    prisma.timetableSlot.findMany.mockResolvedValueOnce([
      { id: "existing-1", startTime: "08:00", endTime: "08:40" },
    ]);
    prisma.timetableSlot.create.mockResolvedValue({ id: "new-slot" });

    await service.create(buildDto({ startTime: "08:40", endTime: "09:20" }), "user-1");

    expect(prisma.timetableSlot.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a second slot for the same venue with an overlapping time, different staff", async () => {
    // First findMany call (staff check) returns no conflict, second (venue check) does.
    prisma.timetableSlot.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "existing-1", startTime: "08:00", endTime: "08:40" },
    ]);

    await expect(
      service.create(
        buildDto({ staffId: "staff-2", venue: "Hall A", startTime: "08:20", endTime: "09:00" }),
        "user-1",
      ),
    ).rejects.toThrow(/already booked/);
    expect(prisma.timetableSlot.create).not.toHaveBeenCalled();
  });

  it("allows the same time/day for a different venue and different staff (no false positive)", async () => {
    prisma.timetableSlot.findMany.mockResolvedValue([]);
    prisma.timetableSlot.create.mockResolvedValue({ id: "new-slot" });

    await service.create(buildDto({ staffId: "staff-2", venue: "Hall B" }), "user-1");

    expect(prisma.timetableSlot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          generatedBy: TimetableGeneratedBy.MANUAL,
          approvalStatus: TimetableApprovalStatus.APPROVED,
        }),
      }),
    );
  });

  it("allows the same subject/teacher at an overlapping time in a sibling arm of the same class level (elective block)", async () => {
    // The existing slot is for a DIFFERENT class arm ("arm-2") than the one
    // being created ("arm-1" via buildDto's default), same subjectId.
    prisma.timetableSlot.findMany.mockResolvedValueOnce([
      { id: "existing-1", startTime: "08:00", endTime: "08:40", subjectId: "subj-1", classArmId: "arm-2" },
    ]);
    prisma.classArm.findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve({ classLevel: { id: "level-1", category: ClassLevelCategory.PRIMARY } }),
    );
    prisma.timetableSlot.create.mockResolvedValue({ id: "new-slot" });

    await service.create(buildDto({ startTime: "08:20", endTime: "09:00" }), "user-1");

    expect(prisma.timetableSlot.create).toHaveBeenCalledTimes(1);
  });

  it("still rejects the same subject/teacher at an overlapping time in a DIFFERENT class level when SUBJECT_MAX_CONCURRENT_ARMS isn't configured for it", async () => {
    prisma.timetableSlot.findMany.mockResolvedValueOnce([
      { id: "existing-1", startTime: "08:00", endTime: "08:40", subjectId: "subj-1", classArmId: "arm-2" },
    ]);
    prisma.classArm.findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve({ classLevel: { id: id === "arm-1" ? "level-1" : "level-2", category: ClassLevelCategory.PRIMARY } }),
    );
    prisma.schedulingConstraint.findFirst.mockResolvedValue(null);

    await expect(service.create(buildDto({ startTime: "08:20", endTime: "09:00" }), "user-1")).rejects.toThrow(
      /Teacher is already booked/,
    );
    expect(prisma.timetableSlot.create).not.toHaveBeenCalled();
  });

  it("allows a cross-level shared session when SUBJECT_MAX_CONCURRENT_ARMS(2) is configured for this subject (Music/French's shared specialist)", async () => {
    prisma.timetableSlot.findMany.mockResolvedValueOnce([
      { id: "existing-1", startTime: "08:00", endTime: "08:40", subjectId: "subj-1", classArmId: "arm-2" },
    ]);
    prisma.classArm.findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve({ classLevel: { id: id === "arm-1" ? "level-1" : "level-2", category: ClassLevelCategory.PRIMARY } }),
    );
    prisma.subject.findUnique.mockResolvedValue({ name: "Music" });
    prisma.schedulingConstraint.findFirst.mockResolvedValue({ value: ["MUSIC:2", "FRENCH:2"] });
    prisma.timetableSlot.create.mockResolvedValue({ id: "new-slot" });

    await service.create(buildDto({ startTime: "08:20", endTime: "09:00" }), "user-1");

    expect(prisma.timetableSlot.create).toHaveBeenCalledTimes(1);
  });

  it("still rejects an overlapping slot for a DIFFERENT subject even with the same teacher (not an elective-block match)", async () => {
    prisma.timetableSlot.findMany.mockResolvedValueOnce([
      { id: "existing-1", startTime: "08:00", endTime: "08:40", subjectId: "subj-OTHER", classArmId: "arm-2" },
    ]);

    await expect(service.create(buildDto({ startTime: "08:20", endTime: "09:00" }), "user-1")).rejects.toThrow(
      /Teacher is already booked/,
    );
    expect(prisma.classArm.findUnique).not.toHaveBeenCalled();
    expect(prisma.timetableSlot.create).not.toHaveBeenCalled();
  });

  it("update() excludes the slot's own id from the conflict query", async () => {
    prisma.timetableSlot.findUniqueOrThrow.mockResolvedValue(buildDto());
    prisma.timetableSlot.findMany.mockResolvedValue([]);
    prisma.timetableSlot.update.mockResolvedValue({ id: "slot-1" });

    await service.update("slot-1", { venue: "Hall C" });

    for (const call of prisma.timetableSlot.findMany.mock.calls) {
      expect(call[0].where.id).toEqual({ not: "slot-1" });
    }
  });
});
