import { WorkerNotificationService } from "./worker-notification.service";

function buildPrismaMock() {
  return {
    notificationTemplate: { findUniqueOrThrow: jest.fn() },
    notificationPreference: { findUnique: jest.fn() },
    notification: { create: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
    emailLog: { create: jest.fn() },
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  const emailQueue = { add: jest.fn() };
  return { service: new WorkerNotificationService(prisma as never, emailQueue as never), emailQueue };
}

describe("WorkerNotificationService.notify", () => {
  it("creates an in-app row and enqueues an email job for a BOTH-channel type with no preference override", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({
      key: "INVOICE_OVERDUE",
      isCritical: true,
      channel: "BOTH",
      subject: "Invoice overdue",
      bodyTemplate: "{{studentName}}'s invoice is overdue. Outstanding balance: {{outstandingAmount}}.",
    });
    prisma.notification.create.mockResolvedValue({ id: "n1" });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: "guardian-1", email: "guardian@x.com" });
    prisma.emailLog.create.mockResolvedValue({ id: "log-1" });
    const { service, emailQueue } = buildService(prisma);

    await service.notify("guardian-1", "INVOICE_OVERDUE" as never, { studentName: "Ada Lovelace", outstandingAmount: 5000 });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        recipientUserId: "guardian-1",
        type: "INVOICE_OVERDUE",
        title: "Invoice overdue",
        body: "Ada Lovelace's invoice is overdue. Outstanding balance: 5000.",
      },
    });
    expect(emailQueue.add).toHaveBeenCalledWith(
      "send",
      expect.objectContaining({ emailLogId: "log-1", recipientEmail: "guardian@x.com" }),
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    );
  });

  it("FR8.6: ignores a disabled preference for a critical type", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({
      key: "INVOICE_OVERDUE",
      isCritical: true,
      channel: "IN_APP",
      subject: "x",
      bodyTemplate: "y",
    });
    prisma.notification.create.mockResolvedValue({ id: "n1" });
    const { service } = buildService(prisma);

    await service.notify("guardian-1", "INVOICE_OVERDUE" as never);

    expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalled();
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
    const { service } = buildService(prisma);

    await service.notify("guardian-1", "PAYMENT_RECEIVED" as never);

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("an EMAIL-only channel type dispatches email but creates no in-app row", async () => {
    const prisma = buildPrismaMock();
    prisma.notificationTemplate.findUniqueOrThrow.mockResolvedValue({
      key: "PASSWORD_RESET",
      isCritical: true,
      channel: "EMAIL",
      subject: "Reset",
      bodyTemplate: "{{resetUrl}}",
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", email: "u@x.com" });
    prisma.emailLog.create.mockResolvedValue({ id: "log-2" });
    const { service, emailQueue } = buildService(prisma);

    await service.notify("user-1", "PASSWORD_RESET" as never, { resetUrl: "http://x/reset" });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(emailQueue.add).toHaveBeenCalled();
  });
});
