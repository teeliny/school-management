import { StaffProfileController, StaffProfileService } from "./staff-profile";
import { AbilityFactory } from "../../casl/ability.factory";
import type { RequestUser } from "../../auth/jwt.strategy";

const abilityFactory = new AbilityFactory();

const STAFF_OWNER: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: [] };
const OTHER_STAFF: RequestUser = { id: "user-2", roles: ["STAFF"], assignmentTypes: [] };
const ADMIN: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };

describe("StaffProfileService.update (phone lives on User, not StaffProfile)", () => {
  it("writes phone to User and the rest of the DTO to StaffProfile, in one transaction", async () => {
    const tx = {
      staffProfile: {
        update: jest.fn().mockResolvedValue({ id: "staff-1", userId: "user-1" }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "staff-1", userId: "user-1", user: { phone: "080" } }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((fn: (tx: typeof tx) => unknown) => fn(tx)) };
    const service = new StaffProfileService(prisma as never);

    await service.update("staff-1", { department: "Science", phone: "080" });

    expect(tx.staffProfile.update).toHaveBeenCalledWith({ where: { id: "staff-1" }, data: { department: "Science" } });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { phone: "080" } });
  });

  it("leaves User untouched when phone isn't part of the update", async () => {
    const tx = {
      staffProfile: {
        update: jest.fn().mockResolvedValue({ id: "staff-1", userId: "user-1" }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "staff-1", userId: "user-1", user: { phone: null } }),
      },
      user: { update: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((fn: (tx: typeof tx) => unknown) => fn(tx)) };
    const service = new StaffProfileService(prisma as never);

    await service.update("staff-1", { department: "Science" });

    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe("StaffProfileController.update — self-service edits are contact-info-only", () => {
  function buildController(profile: { id: string; userId: string }) {
    const service = {
      findOne: jest.fn().mockResolvedValue(profile),
      update: jest.fn().mockResolvedValue({}),
    };
    const controller = new StaffProfileController(service as never, abilityFactory);
    return { controller, service };
  }

  it("narrows a self-edit (no 'manage' grant) down to phone only, dropping HR fields", async () => {
    const { controller, service } = buildController({ id: "staff-1", userId: "user-1" });

    await controller.update("staff-1", { phone: "080", department: "Science", status: "ACTIVE" as never }, STAFF_OWNER);

    expect(service.update).toHaveBeenCalledWith("staff-1", { phone: "080" });
  });

  it("lets an Admin ('manage' grant) update every field", async () => {
    const { controller, service } = buildController({ id: "staff-1", userId: "user-1" });
    const dto = { phone: "080", department: "Science", status: "ACTIVE" as never };

    await controller.update("staff-1", dto, ADMIN);

    expect(service.update).toHaveBeenCalledWith("staff-1", dto);
  });

  it("rejects a staff member editing someone else's profile", async () => {
    const { controller } = buildController({ id: "staff-1", userId: "user-1" });

    await expect(controller.update("staff-1", { phone: "080" }, OTHER_STAFF)).rejects.toThrow(/Insufficient permissions/);
  });
});
