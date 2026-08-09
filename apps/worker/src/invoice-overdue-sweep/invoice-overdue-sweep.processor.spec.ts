import { InvoiceOverdueSweepProcessor } from "./invoice-overdue-sweep.processor";

const PAST_DUE_DATE = new Date("2020-01-01T00:00:00Z");
const FUTURE_DUE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice-1",
    totalAmount: 5000,
    dueDate: PAST_DUE_DATE,
    status: "UNPAID",
    lineItems: [],
    payments: [],
    student: {
      user: { firstName: "Ada", lastName: "Lovelace" },
      guardians: [{ parent: { userId: "guardian-1" } }, { parent: { userId: "guardian-2" } }],
    },
    ...overrides,
  };
}

function buildPrismaMock() {
  return {
    invoice: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  };
}

function buildQueueMock() {
  return { add: jest.fn() };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  const notifications = { notify: jest.fn() };
  const processor = new InvoiceOverdueSweepProcessor(prisma as never, notifications as never, buildQueueMock() as never);
  return { processor, notifications };
}

describe("InvoiceOverdueSweepProcessor.process", () => {
  it("flips a past-due, fully-outstanding invoice to OVERDUE and notifies every guardian", async () => {
    const prisma = buildPrismaMock();
    prisma.invoice.findMany.mockResolvedValue([buildInvoice()]);
    const { processor, notifications } = buildService(prisma);

    await processor.process({} as never);

    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: "invoice-1" }, data: { status: "OVERDUE" } });
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith("guardian-1", "INVOICE_OVERDUE", {
      studentName: "Ada Lovelace",
      outstandingAmount: 5000,
    });
    expect(notifications.notify).toHaveBeenCalledWith("guardian-2", "INVOICE_OVERDUE", {
      studentName: "Ada Lovelace",
      outstandingAmount: 5000,
    });
  });

  it("leaves a fully-paid invoice alone even if it was somehow returned by the query", async () => {
    const prisma = buildPrismaMock();
    prisma.invoice.findMany.mockResolvedValue([
      buildInvoice({ payments: [{ status: "SUCCESSFUL", amount: 5000 }] }),
    ]);
    const { processor, notifications } = buildService(prisma);

    await processor.process({} as never);

    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("leaves a not-yet-due invoice alone", async () => {
    const prisma = buildPrismaMock();
    prisma.invoice.findMany.mockResolvedValue([buildInvoice({ dueDate: FUTURE_DUE_DATE })]);
    const { processor, notifications } = buildService(prisma);

    await processor.process({} as never);

    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("a PARTIAL invoice still overdue gets flipped and notified once per guardian, not once per invoice", async () => {
    const prisma = buildPrismaMock();
    prisma.invoice.findMany.mockResolvedValue([
      buildInvoice({ status: "PARTIAL", payments: [{ status: "SUCCESSFUL", amount: 1000 }] }),
    ]);
    const { processor, notifications } = buildService(prisma);

    await processor.process({} as never);

    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: "invoice-1" }, data: { status: "OVERDUE" } });
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith("guardian-1", "INVOICE_OVERDUE", {
      studentName: "Ada Lovelace",
      outstandingAmount: 4000,
    });
  });

  it("a notify() failure for one guardian doesn't stop the sweep or the other guardian's notification", async () => {
    const prisma = buildPrismaMock();
    prisma.invoice.findMany.mockResolvedValue([buildInvoice()]);
    const { processor, notifications } = buildService(prisma);
    notifications.notify.mockRejectedValueOnce(new Error("notify down")).mockResolvedValueOnce(undefined);

    await expect(processor.process({} as never)).resolves.toBeUndefined();
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });
});
