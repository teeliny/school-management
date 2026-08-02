import { DayOfWeek, TimetableApprovalStatus, TimetableGeneratedBy } from "@prisma/client";
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
