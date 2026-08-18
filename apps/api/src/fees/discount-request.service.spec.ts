import { DiscountRequestService } from "./discount-request";
import { AbilityFactory } from "../casl/ability.factory";
import type { RequestUser } from "../auth/jwt.strategy";

const abilityFactory = new AbilityFactory();

const BURSAR: RequestUser = { id: "bursar-1", roles: ["STAFF"], assignmentTypes: ["BURSAR"] };
const SUPER_ADMIN: RequestUser = { id: "super-1", roles: ["SUPER_ADMIN"], assignmentTypes: [] };

const FUTURE_DUE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function buildInvoice(
  overrides: Partial<{
    totalAmount: number;
    lineItems: unknown[];
    payments: unknown[];
  }> = {},
) {
  return {
    id: "invoice-1",
    totalAmount: 5000,
    dueDate: FUTURE_DUE_DATE,
    lineItems: [],
    payments: [],
    student: { user: { firstName: "Ada", lastName: "Lovelace" } },
    ...overrides,
  };
}

function buildPrismaMock() {
  const tx = {
    discountRequest: { update: jest.fn().mockResolvedValue({ id: "discount-request-1", status: "APPROVED" }) },
    invoiceLineItem: { create: jest.fn().mockResolvedValue({}) },
    invoice: { update: jest.fn().mockResolvedValue({}) },
  };
  return {
    invoice: { findUniqueOrThrow: jest.fn().mockResolvedValue(buildInvoice()), update: jest.fn().mockResolvedValue({}) },
    staffProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    discountRequest: {
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: "discount-request-1" }),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: typeof tx) => unknown)(tx);
      return Promise.all(arg as Promise<unknown>[]);
    }),
    __tx: tx,
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  const notifications = { notify: jest.fn() };
  return { service: new DiscountRequestService(prisma as never, notifications as never), notifications };
}

describe("DiscountRequestService.raise (PRD FR7.8)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: DiscountRequestService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = buildService(prisma).service;
  });

  it("creates a PENDING discount request without touching the invoice", async () => {
    await service.raise({ invoiceId: "invoice-1", type: "PERCENTAGE", value: 10, reason: "Sibling discount" } as never, BURSAR);

    expect(prisma.discountRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invoiceId: "invoice-1", type: "PERCENTAGE", value: 10, reason: "Sibling discount", status: "PENDING" }),
      }),
    );
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("resolves requestedByStaffId from the caller's own StaffProfile", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue({ id: "staff-1" });

    await service.raise({ invoiceId: "invoice-1", type: "FIXED_AMOUNT", value: 500, reason: "Hardship" } as never, BURSAR);

    expect(prisma.discountRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestedByStaffId: "staff-1" }) }),
    );
  });

  it("rejects raising against an invoice with no outstanding balance", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(
      buildInvoice({ payments: [{ status: "SUCCESSFUL", amount: 5000 }] }),
    );

    await expect(
      service.raise({ invoiceId: "invoice-1", type: "PERCENTAGE", value: 10, reason: "Sibling discount" } as never, BURSAR),
    ).rejects.toThrow(/outstanding balance/);
    expect(prisma.discountRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a PERCENTAGE value greater than 100", async () => {
    await expect(
      service.raise({ invoiceId: "invoice-1", type: "PERCENTAGE", value: 150, reason: "Too generous" } as never, BURSAR),
    ).rejects.toThrow(/cannot exceed 100/);
    expect(prisma.discountRequest.create).not.toHaveBeenCalled();
  });
});

describe("DiscountRequestService.approve / reject (PRD FR7.8)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: DiscountRequestService;
  let notifications: { notify: jest.Mock };

  function buildPendingDiscountRequest(overrides: Record<string, unknown> = {}) {
    return {
      id: "discount-request-1",
      status: "PENDING",
      type: "PERCENTAGE",
      value: 10,
      reason: "Sibling discount",
      invoice: buildInvoice({ totalAmount: 5000 }),
      requestedByStaff: { userId: "bursar-user-1" },
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = buildPrismaMock();
    ({ service, notifications } = buildService(prisma));
    prisma.discountRequest.findUniqueOrThrow.mockResolvedValue(buildPendingDiscountRequest());
  });

  it("approves a PERCENTAGE request: creates a correctly-signed negative line item and recomputes the invoice", async () => {
    const result = await service.approve("discount-request-1", "super-1");

    expect(prisma.__tx.discountRequest.update).toHaveBeenCalledWith({
      where: { id: "discount-request-1" },
      data: expect.objectContaining({ status: "APPROVED", reviewedByUserId: "super-1" }),
    });
    expect(prisma.__tx.invoiceLineItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ invoiceId: "invoice-1", type: "DISCOUNT", amount: -500 }),
    });
    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith({ where: { id: "invoice-1" }, data: { status: "UNPAID" } });
    expect(result.outstandingBalance).toBe(4500);
    expect(notifications.notify).toHaveBeenCalledWith("bursar-user-1", "DISCOUNT_REQUEST_APPROVED", {
      studentName: "Ada Lovelace",
    });
  });

  it("approves a FIXED_AMOUNT request using the raw value", async () => {
    prisma.discountRequest.findUniqueOrThrow.mockResolvedValue(
      buildPendingDiscountRequest({ type: "FIXED_AMOUNT", value: 750 }),
    );

    const result = await service.approve("discount-request-1", "super-1");

    expect(prisma.__tx.invoiceLineItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: -750 }),
    });
    expect(result.outstandingBalance).toBe(4250);
  });

  it("rejects approving a discount request that isn't PENDING", async () => {
    prisma.discountRequest.findUniqueOrThrow.mockResolvedValue(buildPendingDiscountRequest({ status: "APPROVED" }));

    await expect(service.approve("discount-request-1", "super-1")).rejects.toThrow(/PENDING/);
    expect(prisma.__tx.discountRequest.update).not.toHaveBeenCalled();
  });

  it("skips notifying when the request was raised without a StaffProfile (override)", async () => {
    prisma.discountRequest.findUniqueOrThrow.mockResolvedValue(buildPendingDiscountRequest({ requestedByStaff: null }));

    await service.approve("discount-request-1", "super-1");

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("a notify() failure doesn't propagate out of approve()", async () => {
    notifications.notify.mockRejectedValue(new Error("notify down"));

    await expect(service.approve("discount-request-1", "super-1")).resolves.toBeDefined();
  });

  it("rejects a PENDING discount request with the given reason, leaving the invoice untouched", async () => {
    const result = await service.reject("discount-request-1", "super-1", "Not eligible");

    expect(prisma.discountRequest.update).toHaveBeenCalledWith({
      where: { id: "discount-request-1" },
      data: expect.objectContaining({ status: "REJECTED", reviewedByUserId: "super-1", rejectionReason: "Not eligible" }),
    });
    expect(prisma.__tx.invoice.update).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(notifications.notify).toHaveBeenCalledWith("bursar-user-1", "DISCOUNT_REQUEST_REJECTED", {
      studentName: "Ada Lovelace",
      reason: "Not eligible",
    });
  });

  it("rejects re-rejecting a discount request that isn't PENDING", async () => {
    prisma.discountRequest.findUniqueOrThrow.mockResolvedValue(buildPendingDiscountRequest({ status: "REJECTED" }));

    await expect(service.reject("discount-request-1", "super-1", "reason")).rejects.toThrow(/PENDING/);
    expect(prisma.discountRequest.update).not.toHaveBeenCalled();
  });
});

describe("DiscountRequestService.findAllForUser (CASL scoping)", () => {
  it("returns an empty result for a user without a manage grant", async () => {
    const prisma = buildPrismaMock();
    const { service } = buildService(prisma);
    const ability = abilityFactory.createForUser({ id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] });

    const result = await service.findAllForUser({ id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] }, ability);

    expect(result).toEqual([]);
    expect(prisma.discountRequest.findMany).not.toHaveBeenCalled();
  });

  it("returns results for a Bursar/Super-Admin", async () => {
    const prisma = buildPrismaMock();
    const { service } = buildService(prisma);
    const ability = abilityFactory.createForUser(SUPER_ADMIN);

    await service.findAllForUser(SUPER_ADMIN, ability);

    expect(prisma.discountRequest.findMany).toHaveBeenCalled();
  });
});
