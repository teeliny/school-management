import { AcademicSessionService } from "./academic-session";
import type { CreateAcademicSessionDto } from "./dto/academic-session.dto";

function buildTxMock() {
  return {
    academicSession: { create: jest.fn(), findFirst: jest.fn() },
    classSubject: { findMany: jest.fn(), createMany: jest.fn() },
  };
}

const dto: CreateAcademicSessionDto = {
  name: "2026/2027",
  startDate: new Date("2026-09-01"),
  endDate: new Date("2027-07-31"),
};

describe("AcademicSessionService.create — carrying subject assignments forward", () => {
  let tx: ReturnType<typeof buildTxMock>;
  let prisma: { $transaction: jest.Mock };
  let service: AcademicSessionService;

  beforeEach(() => {
    tx = buildTxMock();
    prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
    service = new AcademicSessionService(prisma as never);
    tx.academicSession.create.mockResolvedValue({ id: "session-new", ...dto });
  });

  it("copies the chronologically-preceding session's ClassSubject rows into the new session", async () => {
    tx.academicSession.findFirst.mockResolvedValue({ id: "session-prev", startDate: new Date("2025-09-01") });
    tx.classSubject.findMany.mockResolvedValue([
      { classLevelId: "level-1", subjectId: "subj-1", isCompulsoryOverride: null },
      { classLevelId: "level-1", subjectId: "subj-2", isCompulsoryOverride: true },
    ]);

    await service.create(dto);

    expect(tx.classSubject.createMany).toHaveBeenCalledWith({
      data: [
        { classLevelId: "level-1", subjectId: "subj-1", academicSessionId: "session-new", isCompulsoryOverride: null },
        { classLevelId: "level-1", subjectId: "subj-2", academicSessionId: "session-new", isCompulsoryOverride: true },
      ],
      skipDuplicates: true,
    });
  });

  it("does nothing when there is no preceding session (first session ever)", async () => {
    tx.academicSession.findFirst.mockResolvedValue(null);

    await service.create(dto);

    expect(tx.classSubject.findMany).not.toHaveBeenCalled();
    expect(tx.classSubject.createMany).not.toHaveBeenCalled();
  });

  it("does nothing when the preceding session had no subject assignments", async () => {
    tx.academicSession.findFirst.mockResolvedValue({ id: "session-prev", startDate: new Date("2025-09-01") });
    tx.classSubject.findMany.mockResolvedValue([]);

    await service.create(dto);

    expect(tx.classSubject.createMany).not.toHaveBeenCalled();
  });
});
