import { InvitationStatus, Role, UserStatus } from "@prisma/client";
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

function buildAcceptTx(overrides: { user?: { id: string; status: UserStatus } | null; existingRole?: { id: string } | null } = {}) {
  const user = overrides.user === undefined ? { id: "user-1", status: UserStatus.invited } : overrides.user;
  return {
    user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue(user) },
    userRole: {
      findFirst: jest.fn().mockResolvedValue(overrides.existingRole ?? null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    invitation: { update: jest.fn().mockResolvedValue({}) },
  };
}

function buildAcceptService(
  invitation: { id: string; email: string; invitedRole: Role; status: InvitationStatus; expiresAt: Date } | null,
  tx: ReturnType<typeof buildAcceptTx>,
  userServiceOverrides: { findByEmail?: jest.Mock } = {},
) {
  const prisma = {
    invitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
  };
  const userService = { findByEmail: userServiceOverrides.findByEmail ?? jest.fn() };
  const service = new InvitationService(prisma as never, userService as never, {} as never, {} as never);
  return { service, prisma };
}

function buildPendingInvitation(overrides: Partial<{ email: string; invitedRole: Role }> = {}) {
  return {
    id: "invite-1",
    email: overrides.email ?? "a@b.com",
    invitedRole: overrides.invitedRole ?? Role.PARENT,
    status: InvitationStatus.PENDING,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  };
}

describe("InvitationService.accept (PRD FR1.2/FR1.5)", () => {
  it("sets a password and activates a brand-new invited user", async () => {
    const tx = buildAcceptTx({ user: { id: "user-1", status: UserStatus.invited } });
    const { service } = buildAcceptService(buildPendingInvitation(), tx);

    await service.accept("raw-token", "a-real-password");

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: expect.any(String), status: UserStatus.active },
    });
    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: "user-1", role: Role.PARENT } });
  });

  it("rejects a brand-new invited user accepting with no password", async () => {
    const tx = buildAcceptTx({ user: { id: "user-1", status: UserStatus.invited } });
    const { service } = buildAcceptService(buildPendingInvitation(), tx);

    await expect(service.accept("raw-token", undefined)).rejects.toThrow(/Password is required/);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("regression: an already-active user accepting a second-role invite (FR1.5) never touches their password, even if one is submitted", async () => {
    const tx = buildAcceptTx({ user: { id: "user-1", status: UserStatus.active } });
    const { service } = buildAcceptService(buildPendingInvitation({ invitedRole: Role.PARENT }), tx);

    await service.accept("raw-token", "some-password-typed-by-mistake");

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: "user-1", role: Role.PARENT } });
  });

  it("grants the new role to an already-active user with no password submitted at all", async () => {
    const tx = buildAcceptTx({ user: { id: "user-1", status: UserStatus.active } });
    const { service } = buildAcceptService(buildPendingInvitation(), tx);

    await service.accept("raw-token", undefined);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: "user-1", role: Role.PARENT } });
  });

  it("reactivates a previously-deactivated role assignment instead of creating a duplicate", async () => {
    const tx = buildAcceptTx({ user: { id: "user-1", status: UserStatus.active }, existingRole: { id: "role-1" } });
    const { service } = buildAcceptService(buildPendingInvitation(), tx);

    await service.accept("raw-token", undefined);

    expect(tx.userRole.create).not.toHaveBeenCalled();
    expect(tx.userRole.update).toHaveBeenCalledWith({ where: { id: "role-1" }, data: { isActive: true } });
  });
});

describe("InvitationService.peek", () => {
  it("reports alreadyActiveAccount: true for a second-role invite to an existing active user", async () => {
    const { service } = buildAcceptService(buildPendingInvitation(), buildAcceptTx(), {
      findByEmail: jest.fn().mockResolvedValue({ id: "user-1", status: UserStatus.active }),
    });

    const result = await service.peek("raw-token");

    expect(result.alreadyActiveAccount).toBe(true);
  });

  it("reports alreadyActiveAccount: false for a brand-new invitee", async () => {
    const { service } = buildAcceptService(buildPendingInvitation(), buildAcceptTx(), {
      findByEmail: jest.fn().mockResolvedValue(null),
    });

    const result = await service.peek("raw-token");

    expect(result.alreadyActiveAccount).toBe(false);
  });
});
