import { AuditLogRetentionProcessor } from "./audit-log-retention.processor";

function buildPrismaMock() {
  return {
    term: { findFirst: jest.fn().mockResolvedValue(null) },
    auditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

function buildQueueMock() {
  return { add: jest.fn() };
}

function buildProcessor(prisma: ReturnType<typeof buildPrismaMock>, queue = buildQueueMock()) {
  return { processor: new AuditLogRetentionProcessor(prisma as never, queue as never), queue };
}

describe("AuditLogRetentionProcessor.onModuleInit", () => {
  it("registers one repeatable job per term-end month with a distinct jobId", async () => {
    const { processor, queue } = buildProcessor(buildPrismaMock());

    await processor.onModuleInit();

    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenCalledWith("retain", {}, { repeat: { pattern: "30 23 30 4 *" }, jobId: "audit-log-retention-april" });
    expect(queue.add).toHaveBeenCalledWith("retain", {}, { repeat: { pattern: "30 23 31 8 *" }, jobId: "audit-log-retention-august" });
    expect(queue.add).toHaveBeenCalledWith("retain", {}, { repeat: { pattern: "30 23 31 12 *" }, jobId: "audit-log-retention-december" });
  });
});

describe("AuditLogRetentionProcessor.process", () => {
  it("deletes AuditLog rows older than the most recently-started Term's startDate", async () => {
    const prisma = buildPrismaMock();
    const termStart = new Date("2026-01-05T00:00:00Z");
    prisma.term.findFirst.mockResolvedValue({ id: "term-2", name: "Second Term", startDate: termStart });
    prisma.auditLog.deleteMany.mockResolvedValue({ count: 42 });
    const { processor } = buildProcessor(prisma);

    await processor.process({} as never);

    expect(prisma.term.findFirst).toHaveBeenCalledWith({
      where: { startDate: { lte: expect.any(Date) } },
      orderBy: { startDate: "desc" },
    });
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: termStart } } });
  });

  it("no-ops when no Term has been configured yet", async () => {
    const prisma = buildPrismaMock();
    const { processor } = buildProcessor(prisma);

    await processor.process({} as never);

    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});
