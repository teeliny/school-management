import { GatewayTransactionNotFoundError } from "@school/types/payment-gateways";
import { PaymentReconciliationProcessor } from "./payment-reconciliation.processor";

const FUTURE_DUE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
// Just past STUCK_THRESHOLD_MS (15m), same as any ordinary stuck-payment
// fixture — well short of NOT_FOUND_GIVE_UP_MS (1h) so it doesn't
// accidentally trigger the give-up path in tests that don't want it.
const JUST_STUCK_CREATED_AT = new Date(Date.now() - 20 * 60 * 1000);

function buildStuckPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-abcdef12",
    invoiceId: "invoice-1",
    status: "PENDING",
    method: "GATEWAY_CARD",
    gatewayProvider: "MONNIFY",
    createdAt: JUST_STUCK_CREATED_AT,
    invoice: { id: "invoice-1", gatewayPaymentReference: "INV-invoice-1-100" },
    ...overrides,
  };
}

function buildPrismaMock() {
  const tx = {
    payment: { update: jest.fn().mockResolvedValue({ id: "payment-abcdef12" }) },
    invoice: { update: jest.fn().mockResolvedValue({}) },
    receipt: { create: jest.fn().mockResolvedValue({ id: "receipt-1" }) },
  };
  return {
    payment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: "defensive-pending-1" }),
    },
    invoice: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: "invoice-1",
        totalAmount: 5000,
        dueDate: FUTURE_DUE_DATE,
        lineItems: [],
        payments: [{ id: "payment-abcdef12", status: "PENDING", gatewayProvider: "MONNIFY", amount: 5000 }],
      }),
    },
    $transaction: jest.fn((arg: unknown) => (arg as (transaction: typeof tx) => unknown)(tx)),
    __tx: tx,
  };
}

function buildQueueMock() {
  return { add: jest.fn() };
}

function buildCredentialsMock() {
  return { getCredentials: jest.fn().mockResolvedValue({ apiKey: "key", secretKey: "secret", environment: "SANDBOX" }) };
}

function buildAdapterMock() {
  return { initTransaction: jest.fn(), verifyTransaction: jest.fn(), verifyWebhookSignature: jest.fn(), parseWebhookPayload: jest.fn() };
}

describe("PaymentReconciliationProcessor.process (PRD FR7.6)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let credentials: ReturnType<typeof buildCredentialsMock>;
  let sweepQueue: ReturnType<typeof buildQueueMock>;
  let receiptQueue: ReturnType<typeof buildQueueMock>;
  let monnify: ReturnType<typeof buildAdapterMock>;
  let processor: PaymentReconciliationProcessor;

  beforeEach(() => {
    prisma = buildPrismaMock();
    credentials = buildCredentialsMock();
    sweepQueue = buildQueueMock();
    receiptQueue = buildQueueMock();
    monnify = buildAdapterMock();
    processor = new PaymentReconciliationProcessor(
      prisma as never,
      credentials as never,
      sweepQueue as never,
      receiptQueue as never,
      monnify as never,
      buildAdapterMock() as never,
    );
  });

  it("does nothing when there are no stuck payments", async () => {
    await processor.process({} as never);
    expect(monnify.verifyTransaction).not.toHaveBeenCalled();
  });

  it("skips a payment whose invoice has no gatewayPaymentReference", async () => {
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment({ invoice: { id: "invoice-1", gatewayPaymentReference: null } })]);

    await processor.process({} as never);

    expect(monnify.verifyTransaction).not.toHaveBeenCalled();
  });

  it("verifies using credentials/adapter matching the payment's own gatewayProvider", async () => {
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment()]);
    monnify.verifyTransaction.mockResolvedValue({ status: "PENDING" });

    await processor.process({} as never);

    expect(credentials.getCredentials).toHaveBeenCalledWith("MONNIFY");
    expect(monnify.verifyTransaction).toHaveBeenCalledWith(expect.anything(), "INV-invoice-1-100");
  });

  it("resolves a SUCCESSFUL result: updates payment/invoice, creates a receipt, enqueues generation", async () => {
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment()]);
    monnify.verifyTransaction.mockResolvedValue({
      status: "SUCCESSFUL",
      amountPaid: 5000,
      gatewayTransactionReference: "MNFY|TXN|1",
      paidAt: new Date(),
      channel: "CARD",
    });

    await processor.process({} as never);

    expect(prisma.__tx.payment.update).toHaveBeenCalledWith({
      where: { id: "payment-abcdef12" },
      data: expect.objectContaining({ status: "SUCCESSFUL", method: "GATEWAY_CARD" }),
    });
    expect(prisma.__tx.invoice.update).toHaveBeenCalledWith({ where: { id: "invoice-1" }, data: { status: "PAID" } });
    expect(receiptQueue.add).toHaveBeenCalledWith("generate", { receiptId: "receipt-1" });
  });

  it("marks the payment FAILED when the gateway reports a failure", async () => {
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment()]);
    monnify.verifyTransaction.mockResolvedValue({
      status: "FAILED",
      amountPaid: 0,
      gatewayTransactionReference: "MNFY|TXN|2",
      paidAt: null,
      channel: "CARD",
    });

    await processor.process({} as never);

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment-abcdef12" },
      data: { status: "FAILED", gatewayTransactionReference: "MNFY|TXN|2" },
    });
  });

  it("leaves a still-PENDING result untouched", async () => {
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment()]);
    monnify.verifyTransaction.mockResolvedValue({ status: "PENDING" });

    await processor.process({} as never);

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.__tx.payment.update).not.toHaveBeenCalled();
  });

  it("is idempotent — a SUCCESSFUL payment already recorded for this gatewayTransactionReference is not reprocessed", async () => {
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment()]);
    prisma.payment.findFirst.mockResolvedValue({ id: "already-processed" });
    monnify.verifyTransaction.mockResolvedValue({
      status: "SUCCESSFUL",
      amountPaid: 5000,
      gatewayTransactionReference: "MNFY|TXN|1",
      paidAt: new Date(),
      channel: "CARD",
    });

    await processor.process({} as never);

    expect(prisma.__tx.payment.update).not.toHaveBeenCalled();
  });

  it("isolates one payment's failure — a credentials/network error on one doesn't abort the rest of the batch", async () => {
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment({ id: "payment-broken" }), buildStuckPayment()]);
    credentials.getCredentials.mockRejectedValueOnce(new Error("credentials lookup failed"));
    monnify.verifyTransaction.mockResolvedValue({ status: "PENDING" });

    await expect(processor.process({} as never)).resolves.toBeUndefined();

    // The second payment still gets checked even though the first's
    // credentials lookup threw.
    expect(monnify.verifyTransaction).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying a not-found payment that isn't old enough to give up on yet", async () => {
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment()]);
    monnify.verifyTransaction.mockRejectedValue(new GatewayTransactionNotFoundError("no such transaction"));

    await processor.process({} as never);

    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it("gives up and marks FAILED once a not-found payment has been stuck past the give-up threshold", async () => {
    const oldEnough = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h, past the 1h give-up threshold
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment({ createdAt: oldEnough })]);
    monnify.verifyTransaction.mockRejectedValue(new GatewayTransactionNotFoundError("no such transaction"));

    await processor.process({} as never);

    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "payment-abcdef12" },
      data: { status: "FAILED" },
    });
  });

  it("never gives up on a generic/transient error, no matter how old the payment is — only an explicit not-found", async () => {
    const oldEnough = new Date(Date.now() - 2 * 60 * 60 * 1000);
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment({ createdAt: oldEnough })]);
    monnify.verifyTransaction.mockRejectedValue(new Error("Monnify transaction query failed: HTTP 500"));

    await processor.process({} as never);

    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  it("resolves an already-registered PAYSTACK payment using the Paystack adapter, not Monnify's", async () => {
    const paystack = buildAdapterMock();
    const processorWithPaystack = new PaymentReconciliationProcessor(
      prisma as never,
      credentials as never,
      sweepQueue as never,
      receiptQueue as never,
      monnify as never,
      paystack as never,
    );
    prisma.payment.findMany.mockResolvedValue([buildStuckPayment({ gatewayProvider: "PAYSTACK" })]);
    paystack.verifyTransaction.mockResolvedValue({ status: "PENDING" });

    await processorWithPaystack.process({} as never);

    expect(paystack.verifyTransaction).toHaveBeenCalledWith(expect.anything(), "INV-invoice-1-100");
    expect(monnify.verifyTransaction).not.toHaveBeenCalled();
  });
});
