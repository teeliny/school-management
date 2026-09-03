import { EmailProcessor } from "./email.processor";

function buildPrismaMock() {
  return {
    emailLog: { update: jest.fn() },
    schoolProfile: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

function buildConfigMock(apiKey: string | undefined) {
  return {
    get: jest.fn((key: string) => {
      if (key === "RESEND_API_KEY") return apiKey;
      if (key === "RESEND_FROM_EMAIL") return "no-reply@example.com";
      return undefined;
    }),
  };
}

interface ResendClientAccess {
  resend: { emails: { send: jest.Mock } } | null;
}

const jobData = { emailLogId: "log-1", recipientEmail: "a@b.com", subject: "Hi", body: "Body" };

describe("EmailProcessor.process", () => {
  it("logs and marks SENT when RESEND_API_KEY is unset, capturing no resendMessageId", async () => {
    const prisma = buildPrismaMock();
    const processor = new EmailProcessor(prisma as never, buildConfigMock(undefined) as never);

    await processor.process({ data: jobData } as never);

    expect(prisma.emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "SENT", sentAt: expect.any(Date) },
    });
  });

  it("captures resendMessageId and marks SENT on a successful real send", async () => {
    const prisma = buildPrismaMock();
    const processor = new EmailProcessor(prisma as never, buildConfigMock("re_test_key") as never);
    const send = jest.fn().mockResolvedValue({ data: { id: "msg-123" } });
    (processor as unknown as ResendClientAccess).resend!.emails.send = send;

    await processor.process({ data: jobData } as never);

    expect(send).toHaveBeenCalledWith(
      {
        from: "Your School <no-reply@example.com>",
        to: "a@b.com",
        subject: "Hi",
        html: expect.stringContaining("Body"),
        text: expect.stringContaining("Body"),
      },
      { idempotencyKey: "log-1" },
    );
    expect(prisma.emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "SENT", resendMessageId: "msg-123", sentAt: expect.any(Date) },
    });
  });

  it("FR8.3: marks FAILED and rethrows on error, so BullMQ's configured retry re-invokes process()", async () => {
    const prisma = buildPrismaMock();
    const processor = new EmailProcessor(prisma as never, buildConfigMock("re_test_key") as never);
    const send = jest.fn().mockRejectedValue(new Error("network down"));
    (processor as unknown as ResendClientAccess).resend!.emails.send = send;

    await expect(processor.process({ data: jobData } as never)).rejects.toThrow("network down");

    expect(prisma.emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "FAILED", error: "Error: network down" },
    });
  });
});
