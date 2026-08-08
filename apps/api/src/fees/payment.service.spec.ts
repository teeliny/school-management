import { PaymentService } from "./payment";
import { AbilityFactory } from "../casl/ability.factory";
import type { RequestUser } from "../auth/jwt.strategy";

const abilityFactory = new AbilityFactory();

const BURSAR: RequestUser = { id: "bursar-1", roles: ["STAFF"], assignmentTypes: ["BURSAR"] };
const SUPER_ADMIN: RequestUser = { id: "super-1", roles: ["SUPER_ADMIN"], assignmentTypes: [] };
const ADMIN: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };
const PARENT: RequestUser = { id: "parent-user-1", roles: ["PARENT"], assignmentTypes: [] };

const FUTURE_DUE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function buildInvoice(overrides: Partial<{ totalAmount: number; lineItems: unknown[]; payments: unknown[] }> = {}) {
  return {
    id: "invoice-1",
    totalAmount: 5000,
    dueDate: FUTURE_DUE_DATE,
    lineItems: [],
    payments: [],
    ...overrides,
  };
}

function buildPrismaMock() {
  const tx = {
    payment: { create: jest.fn().mockResolvedValue({ id: "payment-abcdef12" }) },
    invoice: { update: jest.fn().mockResolvedValue({}) },
    receipt: { create: jest.fn().mockResolvedValue({ id: "receipt-1" }) },
  };
  return {
    invoice: { findUniqueOrThrow: jest.fn().mockResolvedValue(buildInvoice()) },
    staffProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    payment: { findUniqueOrThrow: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    parentProfile: { findUnique: jest.fn() },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: typeof tx) => unknown)(tx);
      return Promise.all(arg as Promise<unknown>[]);
    }),
    __tx: tx,
  };
}

function buildQueueMock() {
  return { add: jest.fn().mockResolvedValue(undefined) };
}

describe("PaymentService.recordCash (PRD §3.9 — CASH takes effect immediately)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let queue: ReturnType<typeof buildQueueMock>;
  let service: PaymentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    queue = buildQueueMock();
    service = new PaymentService(prisma as never, queue as never);
  });

  it("creates a SUCCESSFUL CASH payment and transitions the invoice to PAID when fully paid", async () => {
    const result = await service.recordCash({ invoiceId: "invoice-1", amount: 5000 }, BURSAR);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ method: "CASH", status: "SUCCESSFUL", amount: 5000 }) }),
    );
    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith({ where: { id: "invoice-1" }, data: { status: "PAID" } });
    expect(result.invoiceStatus).toBe("PAID");
    expect(result.outstandingBalance).toBe(0);
  });

  it("transitions the invoice to PARTIAL when underpaid", async () => {
    const result = await service.recordCash({ invoiceId: "invoice-1", amount: 2000 }, BURSAR);

    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith({ where: { id: "invoice-1" }, data: { status: "PARTIAL" } });
    expect(result.outstandingBalance).toBe(3000);
  });

  it("accounts for prior successful payments already on the invoice", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(buildInvoice({ payments: [{ amount: 1000, status: "SUCCESSFUL" }] }));

    const result = await service.recordCash({ invoiceId: "invoice-1", amount: 4000 }, BURSAR);

    expect(result.invoiceStatus).toBe("PAID");
    expect(result.outstandingBalance).toBe(0);
  });

  it("regression: FEE-type line items are NOT summed into outstandingBalance a second time — totalAmount already includes them", async () => {
    // Realistic shape: totalAmount (5000) was set at generation time to the
    // sum of these two FEE lines. See the identical regression test in
    // invoice.service.spec.ts for the bug this guards against.
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(
      buildInvoice({ lineItems: [{ amount: 4000, type: "FEE" }, { amount: 1000, type: "FEE" }] }),
    );

    const result = await service.recordCash({ invoiceId: "invoice-1", amount: 5000 }, BURSAR);

    expect(result.outstandingBalance).toBe(0);
    expect(result.invoiceStatus).toBe("PAID");
  });

  it("a DISCOUNT-type line item does reduce outstandingBalance, on top of totalAmount", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(
      buildInvoice({ lineItems: [{ amount: 5000, type: "FEE" }, { amount: -1000, type: "DISCOUNT" }] }),
    );

    const result = await service.recordCash({ invoiceId: "invoice-1", amount: 4000 }, BURSAR);

    expect(result.outstandingBalance).toBe(0);
    expect(result.invoiceStatus).toBe("PAID");
  });

  it("resolves recordedByStaffId from the caller's own StaffProfile", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue({ id: "staff-99" });

    await service.recordCash({ invoiceId: "invoice-1", amount: 2000 }, BURSAR);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recordedByStaffId: "staff-99" }) }),
    );
  });

  it("leaves recordedByStaffId null when the caller has no StaffProfile (Super-Admin override)", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue(null);

    await service.recordCash({ invoiceId: "invoice-1", amount: 2000 }, SUPER_ADMIN);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recordedByStaffId: null }) }),
    );
  });

  it("derives a receiptNumber from the payment's own id and enqueues PDF generation", async () => {
    const result = await service.recordCash({ invoiceId: "invoice-1", amount: 5000 }, BURSAR);

    expect(prisma.__tx.receipt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ receiptNumber: "RCT-PAYMENT-", paymentId: "payment-abcdef12" }) }),
    );
    expect(queue.add).toHaveBeenCalledWith("generate", { receiptId: "receipt-1" });
    expect(result.receipt.id).toBe("receipt-1");
  });
});

describe("PaymentService read scoping (PRD §5 — Admin has no visibility into Fees)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: PaymentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new PaymentService(prisma as never, buildQueueMock() as never);
  });

  it("Bursar/Super-Admin see every payment, unscoped", async () => {
    for (const user of [BURSAR, SUPER_ADMIN]) {
      prisma.payment.findMany.mockClear();
      const ability = abilityFactory.createForUser(user);
      await service.findAllForUser(user, ability);
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{}, {}, {}] } }),
      );
    }
  });

  it("a parent sees only payments against her wards' invoices", async () => {
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-profile-1" });
    const ability = abilityFactory.createForUser(PARENT);

    await service.findAllForUser(PARENT, ability);

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ invoice: { student: { guardians: { some: { parentId: "parent-profile-1" } } } } }, {}, {}],
        },
      }),
    );
  });

  it("regression: a parent's guardian-scoping survives combining with a studentId filter, instead of one clobbering the other", async () => {
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-profile-1" });
    const ability = abilityFactory.createForUser(PARENT);

    await service.findAllForUser(PARENT, ability, { studentId: "student-9" });

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { invoice: { student: { guardians: { some: { parentId: "parent-profile-1" } } } } },
            {},
            { invoice: { studentId: "student-9" } },
          ],
        },
      }),
    );
  });

  it("a plain ADMIN gets an empty list — Admin has zero visibility into Fees", async () => {
    const ability = abilityFactory.createForUser(ADMIN);

    const result = await service.findAllForUser(ADMIN, ability);

    expect(result).toEqual([]);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it("findOneForUser rejects a parent viewing a payment on another family's invoice", async () => {
    prisma.payment.findUniqueOrThrow.mockResolvedValue({
      id: "payment-1",
      invoice: { student: { guardians: [{ parentId: "someone-elses-parent-profile" }] } },
    });
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-profile-1" });
    const ability = abilityFactory.createForUser(PARENT);

    await expect(service.findOneForUser("payment-1", PARENT, ability)).rejects.toThrow(/Insufficient permissions/);
  });
});
