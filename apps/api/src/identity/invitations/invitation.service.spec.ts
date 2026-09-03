import { Role } from "@prisma/client";
import { InvitationService } from "./invitation.service";

function buildTx(overrides: { existingUser?: { id: string; email: string } } = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(overrides.existingUser ?? null),
      create: jest.fn().mockResolvedValue({ id: "new-user-1", email: "a@b.com" }),
      update: jest.fn().mockResolvedValue({ id: overrides.existingUser?.id, email: overrides.existingUser?.email }),
    },
    staffProfile: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    parentProfile: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    adminProfile: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    invitation: { create: jest.fn().mockResolvedValue({ id: "invite-1", email: "a@b.com", invitedRole: Role.PARENT }) },
  };
}

function buildService() {
  return new InvitationService({} as never, {} as never, {} as never, {} as never);
}

describe("InvitationService.createInTx — phone lives on User", () => {
  it("sets phone when creating a brand-new User", async () => {
    const tx = buildTx();
    const service = buildService();

    await service.createInTx(tx as never, {
      email: "a@b.com",
      firstName: "Ada",
      lastName: "Lovelace",
      invitedRole: Role.PARENT,
      phone: "080",
    });

    expect(tx.user.create).toHaveBeenCalledWith({
      data: { email: "a@b.com", firstName: "Ada", lastName: "Lovelace", phone: "080" },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("regression: a re-invite of an existing User (gaining a second role) still applies a provided phone, instead of silently dropping it", async () => {
    const tx = buildTx({ existingUser: { id: "user-1", email: "a@b.com" } });
    const service = buildService();

    await service.createInTx(tx as never, {
      email: "a@b.com",
      firstName: "Ada",
      lastName: "Lovelace",
      invitedRole: Role.PARENT,
      phone: "080",
    });

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { phone: "080" } });
  });

  it("leaves an existing User's phone untouched when the re-invite doesn't include one", async () => {
    const tx = buildTx({ existingUser: { id: "user-1", email: "a@b.com" } });
    const service = buildService();

    await service.createInTx(tx as never, {
      email: "a@b.com",
      firstName: "Ada",
      lastName: "Lovelace",
      invitedRole: Role.PARENT,
    });

    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
