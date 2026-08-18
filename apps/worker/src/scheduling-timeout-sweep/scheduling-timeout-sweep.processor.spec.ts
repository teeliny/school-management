import { SchedulingTimeoutSweepProcessor } from "./scheduling-timeout-sweep.processor";

const NOW = new Date("2026-01-15T12:00:00Z");

function buildStuckRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-1",
    status: "QUEUED",
    scope: "CLASS_TIMETABLE",
    requestedByUserId: "user-1",
    requestedAt: new Date("2026-01-15T11:00:00Z"),
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    scheduleGenerationRequest: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  };
}

function buildConfigMock(timeoutMinutes?: string) {
  return { get: jest.fn().mockReturnValue(timeoutMinutes) };
}

function buildQueueMock() {
  return { add: jest.fn() };
}

function buildProcessor(prisma: ReturnType<typeof buildPrismaMock>, config: ReturnType<typeof buildConfigMock>) {
  const notifications = { notify: jest.fn() };
  const processor = new SchedulingTimeoutSweepProcessor(
    prisma as never,
    config as never,
    notifications as never,
    buildQueueMock() as never,
  );
  return { processor, notifications };
}

describe("SchedulingTimeoutSweepProcessor.process", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("marks a stuck QUEUED request TIMED_OUT and notifies the requester", async () => {
    const prisma = buildPrismaMock();
    prisma.scheduleGenerationRequest.findMany.mockResolvedValue([buildStuckRequest()]);
    const { processor, notifications } = buildProcessor(prisma, buildConfigMock());

    await processor.process({} as never);

    expect(prisma.scheduleGenerationRequest.update).toHaveBeenCalledWith({
      where: { id: "request-1" },
      data: { status: "TIMED_OUT", completedAt: expect.any(Date) },
    });
    expect(notifications.notify).toHaveBeenCalledWith("user-1", "SCHEDULE_GENERATION_TIMED_OUT", {
      scope: "CLASS_TIMETABLE",
    });
  });

  it("marks a stuck SOLVING request TIMED_OUT the same as QUEUED", async () => {
    const prisma = buildPrismaMock();
    prisma.scheduleGenerationRequest.findMany.mockResolvedValue([buildStuckRequest({ id: "request-2", status: "SOLVING" })]);
    const { processor, notifications } = buildProcessor(prisma, buildConfigMock());

    await processor.process({} as never);

    expect(prisma.scheduleGenerationRequest.update).toHaveBeenCalledWith({
      where: { id: "request-2" },
      data: { status: "TIMED_OUT", completedAt: expect.any(Date) },
    });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no request is stuck", async () => {
    const prisma = buildPrismaMock();
    const { processor, notifications } = buildProcessor(prisma, buildConfigMock());

    await processor.process({} as never);

    expect(prisma.scheduleGenerationRequest.update).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("queries only QUEUED/SOLVING requests older than the configured timeout (SCHEDULING_TIMEOUT_MINUTES)", async () => {
    const prisma = buildPrismaMock();
    const { processor } = buildProcessor(prisma, buildConfigMock("15"));

    await processor.process({} as never);

    expect(prisma.scheduleGenerationRequest.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["QUEUED", "SOLVING"] },
        requestedAt: { lt: new Date(NOW.getTime() - 15 * 60 * 1000) },
      },
    });
  });

  it("falls back to the 10-minute default when SCHEDULING_TIMEOUT_MINUTES is unset", async () => {
    const prisma = buildPrismaMock();
    const { processor } = buildProcessor(prisma, buildConfigMock(undefined));

    await processor.process({} as never);

    expect(prisma.scheduleGenerationRequest.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["QUEUED", "SOLVING"] },
        requestedAt: { lt: new Date(NOW.getTime() - 10 * 60 * 1000) },
      },
    });
  });

  it("a notify() failure for one request doesn't stop the sweep from processing the rest", async () => {
    const prisma = buildPrismaMock();
    prisma.scheduleGenerationRequest.findMany.mockResolvedValue([
      buildStuckRequest({ id: "request-1" }),
      buildStuckRequest({ id: "request-2", requestedByUserId: "user-2" }),
    ]);
    const { processor, notifications } = buildProcessor(prisma, buildConfigMock());
    notifications.notify.mockRejectedValueOnce(new Error("notify down")).mockResolvedValueOnce(undefined);

    await expect(processor.process({} as never)).resolves.toBeUndefined();

    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(prisma.scheduleGenerationRequest.update).toHaveBeenCalledTimes(2);
    expect(prisma.scheduleGenerationRequest.update).toHaveBeenCalledWith({
      where: { id: "request-1" },
      data: { status: "TIMED_OUT", completedAt: expect.any(Date) },
    });
    expect(prisma.scheduleGenerationRequest.update).toHaveBeenCalledWith({
      where: { id: "request-2" },
      data: { status: "TIMED_OUT", completedAt: expect.any(Date) },
    });
  });
});
