import { ForbiddenException } from "@nestjs/common";
import { NotificationPreferenceService } from "./notification-preference";

function buildPrismaMock() {
  return {
    notificationTemplate: { findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    notificationPreference: { findMany: jest.fn(), upsert: jest.fn() },
  };
}

describe("NotificationPreferenceService.update", () => {
  it("FR8.6: rejects any update against a critical notification type", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({ isCritical: true });
    const service = new NotificationPreferenceService(prisma as never);

    await expect(service.update("user-1", "PASSWORD_RESET" as never, { inAppEnabled: false })).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("upserts a preference for a non-critical type", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({ isCritical: false });
    prisma.notificationPreference.upsert.mockResolvedValue({ inAppEnabled: false });
    const service = new NotificationPreferenceService(prisma as never);

    const result = await service.update("user-1", "PAYMENT_RECEIVED" as never, { inAppEnabled: false });

    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId_notificationType: { userId: "user-1", notificationType: "PAYMENT_RECEIVED" } },
      create: { userId: "user-1", notificationType: "PAYMENT_RECEIVED", inAppEnabled: false },
      update: { inAppEnabled: false },
    });
    expect(result).toEqual({ inAppEnabled: false });
  });
});

describe("NotificationPreferenceService.findMine", () => {
  it("defaults a type with no stored preference row to both channels enabled", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findMany.mockResolvedValue([{ key: "PAYMENT_RECEIVED", isCritical: false }]);
    prisma.notificationPreference.findMany.mockResolvedValue([]);
    const service = new NotificationPreferenceService(prisma as never);

    const result = await service.findMine("user-1");

    expect(result).toEqual([
      { notificationType: "PAYMENT_RECEIVED", isCritical: false, inAppEnabled: true, emailEnabled: true },
    ]);
  });

  it("reflects a stored opt-out", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findMany.mockResolvedValue([{ key: "PAYMENT_RECEIVED", isCritical: false }]);
    prisma.notificationPreference.findMany.mockResolvedValue([
      { notificationType: "PAYMENT_RECEIVED", inAppEnabled: false, emailEnabled: true },
    ]);
    const service = new NotificationPreferenceService(prisma as never);

    const result = await service.findMine("user-1");

    expect(result).toEqual([
      { notificationType: "PAYMENT_RECEIVED", isCritical: false, inAppEnabled: false, emailEnabled: true },
    ]);
  });
});
