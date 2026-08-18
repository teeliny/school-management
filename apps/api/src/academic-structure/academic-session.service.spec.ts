import { AcademicSessionService } from "./academic-session";
import type { CreateAcademicSessionDto } from "./dto/academic-session.dto";

const dto: CreateAcademicSessionDto = {
  name: "2026/2027",
  startDate: new Date("2026-09-01"),
  endDate: new Date("2027-07-31"),
};

describe("AcademicSessionService.create", () => {
  it("creates the session with no ClassSubject carry-forward (ClassSubject isn't session-scoped)", async () => {
    const prisma = { academicSession: { create: jest.fn().mockResolvedValue({ id: "session-new", ...dto }) } };
    const service = new AcademicSessionService(prisma as never);

    const result = await service.create(dto);

    expect(prisma.academicSession.create).toHaveBeenCalledWith({ data: dto });
    expect(result).toEqual({ id: "session-new", ...dto });
  });
});
