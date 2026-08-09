import { BadRequestException } from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import { AuthService } from "./auth.service";

function buildDeps(overrides: { user?: unknown } = {}) {
  const userService = {
    findByEmail: jest.fn().mockResolvedValue(overrides.user ?? null),
    findById: jest.fn(),
  };
  const jwtService = { signAsync: jest.fn() };
  const prisma = { user: { update: jest.fn() } };
  const config = { get: jest.fn().mockReturnValue("http://localhost:3000") };
  const notifications = { notify: jest.fn() };
  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    scan: jest.fn().mockResolvedValue(["0", []]),
  };
  const service = new AuthService(
    userService as never,
    jwtService as never,
    prisma as never,
    config as never,
    notifications as never,
    redis as never,
  );
  return { service, userService, prisma, config, notifications, redis };
}

describe("AuthService.forgotPassword", () => {
  it("does nothing (but doesn't throw) for an unregistered email — no account enumeration", async () => {
    const { service, redis, notifications } = buildDeps({ user: null });

    await expect(service.forgotPassword("nobody@example.com")).resolves.toBeUndefined();
    expect(redis.set).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("does nothing for a non-active user (e.g. still just invited)", async () => {
    const { service, redis } = buildDeps({ user: { id: "user-1", status: "invited", email: "pending@example.com" } });

    await service.forgotPassword("pending@example.com");

    expect(redis.set).not.toHaveBeenCalled();
  });

  it("stores a hashed reset token in Redis (30 min TTL) and notifies with a resetUrl", async () => {
    const { service, redis, notifications } = buildDeps({
      user: { id: "user-1", status: UserStatus.active, email: "a@b.com" },
    });

    await service.forgotPassword("a@b.com");

    expect(redis.set).toHaveBeenCalledWith(expect.stringMatching(/^password-reset:/), "user-1", "EX", 1800);
    expect(notifications.notify).toHaveBeenCalledWith(
      "user-1",
      "PASSWORD_RESET",
      expect.objectContaining({ resetUrl: expect.stringContaining("http://localhost:3000/reset-password?token=") }),
    );
  });

  it("a notify() failure doesn't propagate — never leaks account existence via a 500", async () => {
    const { service, notifications } = buildDeps({
      user: { id: "user-1", status: UserStatus.active, email: "a@b.com" },
    });
    notifications.notify.mockRejectedValue(new Error("notify down"));

    await expect(service.forgotPassword("a@b.com")).resolves.toBeUndefined();
  });
});

describe("AuthService.resetPassword", () => {
  it("throws BadRequestException for a missing or expired token", async () => {
    const { service, redis } = buildDeps();
    redis.get.mockResolvedValue(null);

    await expect(service.resetPassword("bad-token", "newpassword123")).rejects.toThrow(BadRequestException);
  });

  it("updates the password hash, deletes the single-use Redis key, and revokes every refresh token", async () => {
    const { service, redis, prisma } = buildDeps();
    redis.get.mockResolvedValue("user-1");

    const result = await service.resetPassword("raw-token", "newpassword123");

    expect(redis.del).toHaveBeenCalled();
    expect(redis.scan).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: expect.any(String) },
    });
    expect(result).toEqual({ id: "user-1" });
  });
});
