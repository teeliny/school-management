import { PaymentService } from "./payment";
import { AbilityFactory } from "../casl/ability.factory";
import type { RequestUser } from "../auth/jwt.strategy";

const abilityFactory = new AbilityFactory();

const BURSAR: RequestUser = { id: "bursar-1", roles: ["STAFF"], assignmentTypes: ["BURSAR"] };
const SUPER_ADMIN: RequestUser = { id: "super-1", roles: ["SUPER_ADMIN"], assignmentTypes: [] };
const ADMIN: RequestUser = { id: "admin-1", roles: ["ADMIN"], assignmentTypes: [] };
const PARENT: RequestUser = { id: "parent-user-1", roles: ["PARENT"], assignmentTypes: [] };

const FUTURE_DUE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

function buildInvoice(
  overrides: Partial<{
    totalAmount: number;
    lineItems: unknown[];
    payments: unknown[];
    student: unknown;
    gatewayPaymentReference: string | null;
  }> = {},
) {
  return {
    id: "invoice-1",
    totalAmount: 5000,
    dueDate: FUTURE_DUE_DATE,
    lineItems: [],
    payments: [],
    student: {
      user: { firstName: "Ada", lastName: "Lovelace" },
      guardians: [{ parentId: "parent-profile-1", parent: { userId: "guardian-user-1" } }],
    },
    gatewayPaymentReference: null,
    ...overrides,
  };
}

function buildPrismaMock() {
  const tx = {
    payment: { create: jest.fn().mockResolvedValue({ id: "payment-abcdef12" }), update: jest.fn().mockResolvedValue({ id: "payment-abcdef12" }) },
    invoice: { update: jest.fn().mockResolvedValue({}) },
    receipt: { create: jest.fn().mockResolvedValue({ id: "receipt-1" }) },
  };
  return {
    invoice: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(buildInvoice()),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
    },
    staffProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    payment: {
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "pending-payment-1" }),
      update: jest.fn().mockResolvedValue({}),
    },
    parentProfile: { findUnique: jest.fn() },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "user-1", email: "payer@example.com", firstName: "Jane", lastName: "Doe" }) },
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

function buildConfigMock(values: Record<string, string> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

function buildCredentialsMock() {
  return {
    getCredentials: jest.fn().mockResolvedValue({ apiKey: "key", secretKey: "secret", environment: "SANDBOX" }),
  };
}

function buildAdapterMock() {
  return {
    initTransaction: jest.fn().mockResolvedValue({ checkoutUrl: "https://sandbox.monnify.com/checkout/xyz" }),
    verifyTransaction: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    parseWebhookPayload: jest.fn(),
  };
}

function buildStorageMock() {
  return {
    put: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue("https://storage.example.com/signed-url"),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>, queue: ReturnType<typeof buildQueueMock>) {
  const config = buildConfigMock({ PAYMENT_GATEWAY_PROVIDER: "MONNIFY", WEB_BASE_URL: "http://localhost:3000" });
  const credentials = buildCredentialsMock();
  const adapter = buildAdapterMock();
  const storage = buildStorageMock();
  const notifications = { notify: jest.fn() };
  const service = new PaymentService(
    prisma as never,
    config as never,
    credentials as never,
    queue as never,
    adapter as never,
    storage as never,
    notifications as never,
  );
  return { service, config, credentials, adapter, storage, notifications };
}

function buildUploadedFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: "proof.png",
    mimetype: "image/png",
    buffer: Buffer.from("fake-image-bytes"),
    size: 16,
    ...overrides,
  } as Express.Multer.File;
}

describe("PaymentService.recordCash (PRD §3.9 — CASH takes effect immediately)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let queue: ReturnType<typeof buildQueueMock>;
  let service: PaymentService;
  let notifications: { notify: jest.Mock };

  beforeEach(() => {
    prisma = buildPrismaMock();
    queue = buildQueueMock();
    ({ service, notifications } = buildService(prisma, queue));
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

  it("notifies every guardian of the student that a payment was received", async () => {
    await service.recordCash({ invoiceId: "invoice-1", amount: 5000 }, BURSAR);

    expect(notifications.notify).toHaveBeenCalledWith("guardian-user-1", "PAYMENT_RECEIVED", {
      amount: 5000,
      studentName: "Ada Lovelace",
    });
  });

  it("a notify() failure doesn't propagate out of recordCash()", async () => {
    notifications.notify.mockRejectedValue(new Error("notify down"));

    await expect(service.recordCash({ invoiceId: "invoice-1", amount: 5000 }, BURSAR)).resolves.toBeDefined();
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
    ({ service } = buildService(prisma, buildQueueMock()));
  });

  it("Bursar/Super-Admin see every payment, unscoped", async () => {
    for (const user of [BURSAR, SUPER_ADMIN]) {
      prisma.payment.findMany.mockClear();
      const ability = abilityFactory.createForUser(user);
      await service.findAllForUser(user, ability);
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{}, {}, {}, {}] } }),
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
          AND: [{ invoice: { student: { guardians: { some: { parentId: "parent-profile-1" } } } } }, {}, {}, {}],
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
            {},
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

describe("PaymentService.initiateGatewayCheckout (PRD FR7.3)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let adapter: ReturnType<typeof buildAdapterMock>;
  let service: PaymentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    prisma.parentProfile.findUnique.mockResolvedValue({ id: "parent-profile-1" });
    ({ service, adapter } = buildService(prisma, buildQueueMock()));
  });

  it("generates and persists a gatewayPaymentReference when the invoice has none yet", async () => {
    const ability = abilityFactory.createForUser(PARENT);

    await service.initiateGatewayCheckout({ invoiceId: "invoice-1" }, PARENT, ability);

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: "invoice-1" },
      data: { gatewayPaymentReference: expect.stringMatching(/^INV-invoice-1-\d+$/) },
    });
  });

  it("reuses an existing gatewayPaymentReference across retries instead of minting a new one", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(buildInvoice({ gatewayPaymentReference: "INV-invoice-1-100" }));
    const ability = abilityFactory.createForUser(PARENT);

    await service.initiateGatewayCheckout({ invoiceId: "invoice-1" }, PARENT, ability);

    expect(prisma.invoice.update).not.toHaveBeenCalled();
    expect(adapter.initTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reference: "INV-invoice-1-100" }),
    );
  });

  it("creates a PENDING Payment for the active provider when none exists yet", async () => {
    const ability = abilityFactory.createForUser(PARENT);

    await service.initiateGatewayCheckout({ invoiceId: "invoice-1" }, PARENT, ability);

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING", gatewayProvider: "MONNIFY", method: "GATEWAY_CARD" }),
      }),
    );
  });

  it("reuses an existing PENDING payment for the same provider instead of creating a second one", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(
      buildInvoice({ payments: [{ status: "PENDING", gatewayProvider: "MONNIFY", amount: 5000 }] }),
    );
    const ability = abilityFactory.createForUser(PARENT);

    await service.initiateGatewayCheckout({ invoiceId: "invoice-1" }, PARENT, ability);

    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it("rejects checkout when the invoice has no outstanding balance", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(
      buildInvoice({ payments: [{ status: "SUCCESSFUL", amount: 5000 }] }),
    );
    const ability = abilityFactory.createForUser(PARENT);

    await expect(service.initiateGatewayCheckout({ invoiceId: "invoice-1" }, PARENT, ability)).rejects.toThrow(
      /no outstanding balance/,
    );
  });

  it("rejects a parent who does not guardian this invoice's student", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(
      buildInvoice({ student: { guardians: [{ parentId: "someone-elses-parent-profile" }] } }),
    );
    const ability = abilityFactory.createForUser(PARENT);

    await expect(service.initiateGatewayCheckout({ invoiceId: "invoice-1" }, PARENT, ability)).rejects.toThrow(
      /Insufficient permissions/,
    );
  });

  it("allows Bursar to initiate checkout without a guardian relationship", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(
      buildInvoice({ student: { guardians: [{ parentId: "someone-elses-parent-profile" }] } }),
    );
    const ability = abilityFactory.createForUser(BURSAR);

    await expect(service.initiateGatewayCheckout({ invoiceId: "invoice-1" }, BURSAR, ability)).resolves.toEqual({
      checkoutUrl: "https://sandbox.monnify.com/checkout/xyz",
    });
  });

  it("calls the gateway adapter with the outstanding balance and payer details", async () => {
    const ability = abilityFactory.createForUser(PARENT);

    await service.initiateGatewayCheckout({ invoiceId: "invoice-1" }, PARENT, ability);

    expect(adapter.initTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: 5000, customerEmail: "payer@example.com", customerName: "Jane Doe" }),
    );
  });
});

describe("PaymentService.resolveGatewayOutcome (PRD FR7.5/FR7.6)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let queue: ReturnType<typeof buildQueueMock>;
  let service: PaymentService;
  let notifications: { notify: jest.Mock };

  function buildGatewayResult(overrides: Partial<{ status: string; amountPaid: number; channel: string }> = {}) {
    return {
      status: "SUCCESSFUL",
      amountPaid: 5000,
      gatewayTransactionReference: "MNFY|TXN|1",
      paidAt: new Date("2026-08-08T10:00:00.000Z"),
      channel: "CARD",
      ...overrides,
    } as never;
  }

  beforeEach(() => {
    prisma = buildPrismaMock();
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(
      buildInvoice({
        payments: [
          { id: "pending-payment-1", status: "PENDING", gatewayProvider: "MONNIFY", amount: 5000, paidByUserId: "payer-user-1" },
        ],
      }),
    );
    queue = buildQueueMock();
    ({ service, notifications } = buildService(prisma, queue));
  });

  it("is a no-op when a SUCCESSFUL payment already has this gatewayTransactionReference (idempotent replay)", async () => {
    prisma.payment.findFirst.mockResolvedValue({ id: "already-processed" });

    await service.resolveGatewayOutcome("invoice-1", "MONNIFY", buildGatewayResult());

    expect(prisma.__tx.payment.update).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("resolves a PENDING payment to SUCCESSFUL, updates the invoice, and enqueues receipt generation", async () => {
    await service.resolveGatewayOutcome("invoice-1", "MONNIFY", buildGatewayResult());

    expect(prisma.__tx.payment.update).toHaveBeenCalledWith({
      where: { id: "pending-payment-1" },
      data: expect.objectContaining({ status: "SUCCESSFUL", gatewayTransactionReference: "MNFY|TXN|1", method: "GATEWAY_CARD" }),
    });
    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith({ where: { id: "invoice-1" }, data: { status: "PAID" } });
    expect(queue.add).toHaveBeenCalledWith("generate", { receiptId: "receipt-1" });
    expect(notifications.notify).toHaveBeenCalledWith("payer-user-1", "PAYMENT_RECEIVED", {
      amount: 5000,
      studentName: "Ada Lovelace",
    });
  });

  it("does not notify when the resolved payment has no paidByUserId (defensive-create branch)", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(buildInvoice({ payments: [] }));
    prisma.payment.create.mockResolvedValue({ id: "pending-payment-1", paidByUserId: null });

    await service.resolveGatewayOutcome("invoice-1", "MONNIFY", buildGatewayResult());

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("marks the payment FAILED when the gateway reports a failure, without touching the invoice", async () => {
    await service.resolveGatewayOutcome("invoice-1", "MONNIFY", buildGatewayResult({ status: "FAILED" }));

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "pending-payment-1" },
      data: { status: "FAILED", gatewayTransactionReference: "MNFY|TXN|1" },
    });
    expect(prisma.__tx.invoice.update).not.toHaveBeenCalled();
  });

  it("does nothing when the gateway still reports PENDING", async () => {
    await service.resolveGatewayOutcome("invoice-1", "MONNIFY", buildGatewayResult({ status: "PENDING" }));

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.__tx.payment.update).not.toHaveBeenCalled();
  });

  it("creates a defensive PENDING payment when resolving an invoice with no matching PENDING row", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(buildInvoice({ payments: [] }));

    await service.resolveGatewayOutcome("invoice-1", "MONNIFY", buildGatewayResult());

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", gatewayProvider: "MONNIFY" }) }),
    );
    expect(prisma.__tx.payment.update).toHaveBeenCalledWith({
      where: { id: "pending-payment-1" },
      data: expect.objectContaining({ status: "SUCCESSFUL" }),
    });
  });

  it("maps the gateway's channel to the correct GATEWAY_* PaymentMethod", async () => {
    await service.resolveGatewayOutcome("invoice-1", "MONNIFY", buildGatewayResult({ channel: "ACCOUNT_TRANSFER" }));

    expect(prisma.__tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ method: "GATEWAY_TRANSFER" }) }),
    );
  });
});

describe("PaymentService.submitManualBankTransfer (PRD FR7.3a)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let storage: ReturnType<typeof buildStorageMock>;
  let service: PaymentService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    ({ service, storage } = buildService(prisma, buildQueueMock()));
  });

  it("uploads the proof file and creates a PENDING_APPROVAL payment without touching the invoice", async () => {
    const file = buildUploadedFile();

    await service.submitManualBankTransfer({ invoiceId: "invoice-1", amount: 3000 }, file, BURSAR);

    expect(storage.put).toHaveBeenCalledWith(expect.stringContaining("payment-proofs/invoice-1/"), file.buffer, "image/png");
    expect(storage.getSignedUrl).toHaveBeenCalledWith(expect.stringContaining("payment-proofs/invoice-1/"), expect.any(Number));
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceId: "invoice-1",
          amount: 3000,
          method: "BANK_TRANSFER_MANUAL",
          status: "PENDING_APPROVAL",
          proofOfPaymentUrl: "https://storage.example.com/signed-url",
        }),
      }),
    );
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("resolves recordedByStaffId from the caller's own StaffProfile", async () => {
    prisma.staffProfile.findUnique.mockResolvedValue({ id: "staff-42" });

    await service.submitManualBankTransfer({ invoiceId: "invoice-1", amount: 3000 }, buildUploadedFile(), BURSAR);

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recordedByStaffId: "staff-42" }) }),
    );
  });

  it("rejects submission when the invoice has no outstanding balance", async () => {
    prisma.invoice.findUniqueOrThrow.mockResolvedValue(buildInvoice({ payments: [{ amount: 5000, status: "SUCCESSFUL" }] }));

    await expect(service.submitManualBankTransfer({ invoiceId: "invoice-1", amount: 100 }, buildUploadedFile(), BURSAR)).rejects.toThrow(
      /no outstanding balance/,
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });
});

describe("PaymentService.approveManualBankTransfer / rejectManualBankTransfer (PRD FR7.3b)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let queue: ReturnType<typeof buildQueueMock>;
  let service: PaymentService;
  let notifications: { notify: jest.Mock };

  function buildPendingManualPayment(overrides: Record<string, unknown> = {}) {
    return {
      id: "payment-abcdef12",
      method: "BANK_TRANSFER_MANUAL",
      status: "PENDING_APPROVAL",
      amount: 3000,
      recordedByStaffId: "staff-bursar-1",
      paidByUserId: null,
      // totalAmount matches the payment amount so approval fully settles
      // the invoice — a cleaner, more representative happy-path than a
      // partial payment for this specific test.
      invoice: buildInvoice({ totalAmount: 3000 }),
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = buildPrismaMock();
    queue = buildQueueMock();
    ({ service, notifications } = buildService(prisma, queue));
    prisma.payment.findUniqueOrThrow.mockResolvedValue(buildPendingManualPayment());
    prisma.staffProfile.findUnique.mockResolvedValue({ id: "staff-bursar-1", userId: "bursar-user-1" });
  });

  it("approves a PENDING_APPROVAL manual transfer: updates the payment, recomputes the invoice, creates a receipt, enqueues generation", async () => {
    const result = await service.approveManualBankTransfer("payment-abcdef12", "super-1");

    expect(prisma.__tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment-abcdef12" },
      data: expect.objectContaining({ status: "SUCCESSFUL", reviewedByUserId: "super-1" }),
    });
    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith({ where: { id: "invoice-1" }, data: { status: "PAID" } });
    expect(queue.add).toHaveBeenCalledWith("generate", { receiptId: "receipt-1" });
    expect(result.outstandingBalance).toBe(0);
    expect(notifications.notify).toHaveBeenCalledWith("bursar-user-1", "MANUAL_PAYMENT_APPROVED", {
      amount: 3000,
      studentName: "Ada Lovelace",
    });
  });

  it("also notifies the parent when paidByUserId happens to be set", async () => {
    prisma.payment.findUniqueOrThrow.mockResolvedValue(buildPendingManualPayment({ paidByUserId: "payer-user-1" }));

    await service.approveManualBankTransfer("payment-abcdef12", "super-1");

    expect(notifications.notify).toHaveBeenCalledWith("payer-user-1", "MANUAL_PAYMENT_APPROVED", {
      amount: 3000,
      studentName: "Ada Lovelace",
    });
  });

  it("rejects approving a payment that isn't PENDING_APPROVAL", async () => {
    prisma.payment.findUniqueOrThrow.mockResolvedValue(buildPendingManualPayment({ status: "SUCCESSFUL" }));

    await expect(service.approveManualBankTransfer("payment-abcdef12", "super-1")).rejects.toThrow(/PENDING_APPROVAL/);
    expect(prisma.__tx.payment.update).not.toHaveBeenCalled();
  });

  it("rejects approving a payment that isn't BANK_TRANSFER_MANUAL", async () => {
    prisma.payment.findUniqueOrThrow.mockResolvedValue(buildPendingManualPayment({ method: "CASH" }));

    await expect(service.approveManualBankTransfer("payment-abcdef12", "super-1")).rejects.toThrow(/PENDING_APPROVAL/);
  });

  it("rejects a PENDING_APPROVAL manual transfer with the given reason, leaving the invoice untouched", async () => {
    const result = await service.rejectManualBankTransfer("payment-abcdef12", "super-1", "Amount does not match proof");

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment-abcdef12" },
      data: expect.objectContaining({ status: "REJECTED", reviewedByUserId: "super-1", rejectionReason: "Amount does not match proof" }),
    });
    expect(prisma.__tx.invoice.update).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(notifications.notify).toHaveBeenCalledWith("bursar-user-1", "MANUAL_PAYMENT_REJECTED", {
      amount: 3000,
      studentName: "Ada Lovelace",
      reason: "Amount does not match proof",
    });
  });

  it("rejects rejecting a payment that isn't PENDING_APPROVAL", async () => {
    prisma.payment.findUniqueOrThrow.mockResolvedValue(buildPendingManualPayment({ status: "REJECTED" }));

    await expect(service.rejectManualBankTransfer("payment-abcdef12", "super-1", "reason")).rejects.toThrow(/PENDING_APPROVAL/);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
});
