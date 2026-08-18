import { UnauthorizedException } from "@nestjs/common";
import { EmailWebhookService } from "./email-webhook";

function buildPrismaMock() {
  return {
    emailLog: { findUnique: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    parentProfile: { update: jest.fn() },
  };
}

function buildConfigMock(secret = "whsec_test_secret") {
  return { getOrThrow: jest.fn().mockReturnValue(secret) };
}

describe("EmailWebhookService.verify", () => {
  it("throws UnauthorizedException when the svix signature doesn't verify", () => {
    const service = new EmailWebhookService(buildConfigMock() as never, buildPrismaMock() as never);

    expect(() =>
      service.verify(Buffer.from('{"type":"email.sent"}'), {
        "svix-id": "msg_1",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,bogus-signature",
      }),
    ).toThrow(UnauthorizedException);
  });
});

describe("EmailWebhookService.handleEvent", () => {
  it("no-ops on an unmapped event type", async () => {
    const prisma = buildPrismaMock();
    const service = new EmailWebhookService(buildConfigMock() as never, prisma as never);

    await service.handleEvent({ type: "email.opened", data: { email_id: "msg_1" } });

    expect(prisma.emailLog.findUnique).not.toHaveBeenCalled();
  });

  it("no-ops when no EmailLog matches the resendMessageId", async () => {
    const prisma = buildPrismaMock();
    prisma.emailLog.findUnique.mockResolvedValue(null);
    const service = new EmailWebhookService(buildConfigMock() as never, prisma as never);

    await service.handleEvent({ type: "email.delivered", data: { email_id: "msg_missing" } });

    expect(prisma.emailLog.update).not.toHaveBeenCalled();
  });

  it("updates status to DELIVERED without touching any guardian record", async () => {
    const prisma = buildPrismaMock();
    prisma.emailLog.findUnique.mockResolvedValue({ id: "log-1", recipientEmail: "parent@x.com" });
    const service = new EmailWebhookService(buildConfigMock() as never, prisma as never);

    await service.handleEvent({ type: "email.delivered", data: { email_id: "msg_1" } });

    expect(prisma.emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "DELIVERED", error: undefined },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("FR8.4: a bounce for a parent's email updates EmailLog and flags the guardian record", async () => {
    const prisma = buildPrismaMock();
    prisma.emailLog.findUnique.mockResolvedValue({ id: "log-2", recipientEmail: "parent@x.com" });
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", parentProfile: { id: "profile-1" } });
    const service = new EmailWebhookService(buildConfigMock() as never, prisma as never);

    await service.handleEvent({
      type: "email.bounced",
      data: { email_id: "msg_2", bounce: { message: "mailbox full" } },
    });

    expect(prisma.emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-2" },
      data: { status: "BOUNCED", error: "mailbox full" },
    });
    expect(prisma.parentProfile.update).toHaveBeenCalledWith({
      where: { id: "profile-1" },
      data: { emailBounced: true, emailBouncedAt: expect.any(Date) },
    });
  });

  it("a bounce for a non-parent email (e.g. staff) updates status but never touches a profile", async () => {
    const prisma = buildPrismaMock();
    prisma.emailLog.findUnique.mockResolvedValue({ id: "log-3", recipientEmail: "staff@x.com" });
    prisma.user.findUnique.mockResolvedValue({ id: "user-2", parentProfile: null });
    const service = new EmailWebhookService(buildConfigMock() as never, prisma as never);

    await service.handleEvent({ type: "email.bounced", data: { email_id: "msg_3" } });

    expect(prisma.parentProfile.update).not.toHaveBeenCalled();
  });
});
