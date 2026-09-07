import { ClassArmService } from "./class-arm";
import type { RequestUser } from "../auth/jwt.strategy";

function buildPrismaMock() {
  return { classArm: { findMany: jest.fn().mockResolvedValue([]) } };
}

function adminUser(): RequestUser {
  return { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };
}

function principalUser(): RequestUser {
  return { id: "user-1", roles: ["STAFF"], assignmentTypes: ["PRINCIPAL"] };
}

function headteacherUser(): RequestUser {
  return { id: "user-2", roles: ["STAFF"], assignmentTypes: ["HEADTEACHER"] };
}

// Root cause of a real bug: this list backs the shared class-arm picker
// behind Report Cards, Attendance, Skills & Comments, Planner, Broadsheet,
// and Gradebook — a Principal/Headteacher could see and act on the other
// title's section through any of those pages because this endpoint applied
// no category scoping at all.
describe("ClassArmService.findAll — Principal/Headteacher section scoping", () => {
  it("stays unscoped for Admin (or any caller with no PRINCIPAL/HEADTEACHER assignment)", async () => {
    const prisma = buildPrismaMock();
    const service = new ClassArmService(prisma as never);

    await service.findAll(undefined, undefined, adminUser());

    expect(prisma.classArm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classLevelId: undefined, academicSessionId: undefined } }),
    );
  });

  it("stays unscoped when no user is supplied (internal callers)", async () => {
    const prisma = buildPrismaMock();
    const service = new ClassArmService(prisma as never);

    await service.findAll();

    expect(prisma.classArm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classLevelId: undefined, academicSessionId: undefined } }),
    );
  });

  it("scopes a PRINCIPAL to JSS/SSS class arms only", async () => {
    const prisma = buildPrismaMock();
    const service = new ClassArmService(prisma as never);

    await service.findAll(undefined, undefined, principalUser());

    expect(prisma.classArm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { classLevelId: undefined, academicSessionId: undefined, classLevel: { category: { in: ["JSS", "SSS"] } } },
      }),
    );
  });

  it("scopes a HEADTEACHER to Creche/Reception/Nursery/Primary class arms only", async () => {
    const prisma = buildPrismaMock();
    const service = new ClassArmService(prisma as never);

    await service.findAll(undefined, undefined, headteacherUser());

    expect(prisma.classArm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          classLevelId: undefined,
          academicSessionId: undefined,
          classLevel: { category: { in: ["CRECHE", "RECEPTION", "NURSERY", "PRIMARY"] } },
        },
      }),
    );
  });

  it("combines a caller-supplied classLevelId with the Principal's own section scope, not replacing it", async () => {
    const prisma = buildPrismaMock();
    const service = new ClassArmService(prisma as never);

    await service.findAll("level-jss2", undefined, principalUser());

    expect(prisma.classArm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { classLevelId: "level-jss2", academicSessionId: undefined, classLevel: { category: { in: ["JSS", "SSS"] } } },
      }),
    );
  });
});
