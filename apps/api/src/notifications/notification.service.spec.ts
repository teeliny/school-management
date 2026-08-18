import { ForbiddenException } from "@nestjs/common";
import { NotificationService } from "./notification";

function buildPrismaMock() {
  return {
    notificationTemplate: { findUniqueOrThrow: jest.fn() },
    notificationPreference: { findUnique: jest.fn() },
    notification: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUniqueOrThrow: jest.fn() },
    emailLog: { create: jest.fn() },
    $transaction: jest.fn((arg: unknown[]) => Promise.all(arg)),
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  const gateway = { emitToUser: jest.fn() };
  const emailQueue = { add: jest.fn() };
  return { service: new NotificationService(prisma as never, gateway as never, emailQueue as never), gateway, emailQueue };
}

describe("NotificationService.notify", () => {
  it("renders the template, creates the row, and pushes both socket events for a non-critical IN_APP type with no override", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({
      key: "PAYMENT_RECEIVED",
      isCritical: false,
      channel: "IN_APP",
      subject: "Payment received",
      bodyTemplate: "Amount: {{amount}}",
    });
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: "n1" });
    prisma.notification.count.mockResolvedValue(2);
    const { service, gateway, emailQueue } = buildService(prisma);

    const result = await service.notify("user-1", "PAYMENT_RECEIVED" as never, { amount: "5000" });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        recipientUserId: "user-1",
        type: "PAYMENT_RECEIVED",
        title: "Payment received",
        body: "Amount: 5000",
      },
    });
    expect(gateway.emitToUser).toHaveBeenCalledWith("user-1", "notification:new", { id: "n1" });
    expect(gateway.emitToUser).toHaveBeenCalledWith("user-1", "notification:unread-count", 2);
    expect(emailQueue.add).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "n1" });
  });

  it("skips creation when the recipient disabled a non-critical type's in-app channel", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({
      key: "PAYMENT_RECEIVED",
      isCritical: false,
      channel: "IN_APP",
      subject: "x",
      bodyTemplate: "y",
    });
    prisma.notificationPreference.findUnique.mockResolvedValue({ inAppEnabled: false, emailEnabled: true });
    const { service, gateway } = buildService(prisma);

    const result = await service.notify("user-1", "PAYMENT_RECEIVED" as never);

    expect(result).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(gateway.emitToUser).not.toHaveBeenCalled();
  });

  it("FR8.6: ignores a disabled preference for a critical type, never even checking it", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({
      key: "REPORT_CARD_PUBLISHED",
      isCritical: true,
      channel: "IN_APP",
      subject: "x",
      bodyTemplate: "y",
    });
    prisma.notification.create.mockResolvedValue({ id: "n2" });
    prisma.notification.count.mockResolvedValue(1);
    const { service } = buildService(prisma);

    await service.notify("user-1", "REPORT_CARD_PUBLISHED" as never);

    expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it("FR8.3: a BOTH-channel template creates the Notification row AND enqueues an email-dispatch job", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({
      key: "MANUAL_PAYMENT_APPROVED",
      isCritical: false,
      channel: "BOTH",
      subject: "Payment approved",
      bodyTemplate: "Approved: {{amount}}",
    });
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: "n3" });
    prisma.notification.count.mockResolvedValue(1);
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", email: "parent@x.com" });
    prisma.emailLog.create.mockResolvedValue({ id: "log-1" });
    const { service, emailQueue } = buildService(prisma);

    await service.notify("user-1", "MANUAL_PAYMENT_APPROVED" as never, { amount: "1000" });

    expect(prisma.emailLog.create).toHaveBeenCalledWith({
      data: { recipientEmail: "parent@x.com", templateKey: "MANUAL_PAYMENT_APPROVED", status: "QUEUED" },
    });
    expect(emailQueue.add).toHaveBeenCalledWith(
      "send",
      { emailLogId: "log-1", recipientEmail: "parent@x.com", subject: "Payment approved", body: "Approved: 1000" },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    );
  });

  it("an EMAIL-only channel template dispatches email but creates no Notification row", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({
      key: "PASSWORD_RESET",
      isCritical: true,
      channel: "EMAIL",
      subject: "Reset your password",
      bodyTemplate: "Click here",
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", email: "user@x.com" });
    prisma.emailLog.create.mockResolvedValue({ id: "log-2" });
    const { service, gateway, emailQueue } = buildService(prisma);

    const result = await service.notify("user-1", "PASSWORD_RESET" as never);

    expect(result).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(gateway.emitToUser).not.toHaveBeenCalled();
    expect(emailQueue.add).toHaveBeenCalled();
  });

  it("a disabled emailEnabled preference skips email dispatch but not the in-app row", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({
      key: "MANUAL_PAYMENT_APPROVED",
      isCritical: false,
      channel: "BOTH",
      subject: "x",
      bodyTemplate: "y",
    });
    prisma.notificationPreference.findUnique.mockResolvedValue({ inAppEnabled: true, emailEnabled: false });
    prisma.notification.create.mockResolvedValue({ id: "n4" });
    prisma.notification.count.mockResolvedValue(1);
    const { service, emailQueue } = buildService(prisma);

    await service.notify("user-1", "MANUAL_PAYMENT_APPROVED" as never);

    expect(prisma.notification.create).toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
  });
});

describe("NotificationService.findMine", () => {
  it("returns a flat array when no `take` is given (the bell's recent-N fetch)", async () => {
    const prisma = buildPrismaMock();
    prisma.notification.findMany.mockResolvedValue([{ id: "n1" }]);
    const { service } = buildService(prisma);

    const result = await service.findMine("user-1");

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { recipientUserId: "user-1" },
      orderBy: { createdAt: "desc" },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: "n1" }]);
  });

  it("returns { data, total } when `take` is given, applying unreadOnly and type filters", async () => {
    const prisma = buildPrismaMock();
    prisma.notification.findMany.mockResolvedValue([{ id: "n1" }]);
    prisma.notification.count.mockResolvedValue(9);
    const { service } = buildService(prisma);

    const result = await service.findMine("user-1", {
      unreadOnly: true,
      type: "PAYMENT_RECEIVED" as never,
      skip: 25,
      take: 25,
    });

    const expectedWhere = { recipientUserId: "user-1", isRead: false, type: "PAYMENT_RECEIVED" };
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: { createdAt: "desc" },
      skip: 25,
      take: 25,
    });
    expect(prisma.notification.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result).toEqual({ data: [{ id: "n1" }], total: 9 });
  });
});

describe("NotificationService.markRead", () => {
  it("throws ForbiddenException when the notification doesn't belong to the caller", async () => {
    const prisma = buildPrismaMock();
    prisma.notification.findUniqueOrThrow.mockResolvedValue({ id: "n1", recipientUserId: "other-user" });
    const { service } = buildService(prisma);

    await expect(service.markRead("user-1", "n1")).rejects.toThrow(ForbiddenException);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it("marks read and pushes the updated unread count when it does", async () => {
    const prisma = buildPrismaMock();
    prisma.notification.findUniqueOrThrow.mockResolvedValue({ id: "n1", recipientUserId: "user-1" });
    prisma.notification.update.mockResolvedValue({ id: "n1", isRead: true });
    prisma.notification.count.mockResolvedValue(0);
    const { service, gateway } = buildService(prisma);

    const result = await service.markRead("user-1", "n1");

    expect(result).toEqual({ id: "n1", isRead: true });
    expect(gateway.emitToUser).toHaveBeenCalledWith("user-1", "notification:unread-count", 0);
  });
});
