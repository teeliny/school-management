import { PaymentGatewayWebhookController } from "./payment-gateway-webhook";

function buildPrismaMock() {
  return { invoice: { findUnique: jest.fn() } };
}

function buildPaymentServiceMock() {
  return { resolveGatewayOutcome: jest.fn().mockResolvedValue({ handled: true }) };
}

function buildCredentialsMock() {
  return { getCredentials: jest.fn().mockResolvedValue({ apiKey: "key", secretKey: "secret", environment: "SANDBOX" }) };
}

function buildAdapterMock() {
  return {
    initTransaction: jest.fn(),
    verifyTransaction: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    parseWebhookPayload: jest.fn().mockReturnValue({
      reference: "INV-1-100",
      status: "SUCCESSFUL",
      amountPaid: 5000,
      gatewayTransactionReference: "MNFY|TXN|1",
      paidAt: new Date(),
      channel: "CARD",
    }),
  };
}

function buildRequest(overrides: Partial<{ rawBody: Buffer; headers: Record<string, string> }> = {}) {
  return {
    rawBody: Buffer.from(JSON.stringify({ paymentReference: "INV-1-100" })),
    headers: { "monnify-signature": "abc123" },
    ...overrides,
  } as never;
}

describe("PaymentGatewayWebhookController (PRD FR7.5)", () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let paymentService: ReturnType<typeof buildPaymentServiceMock>;
  let credentials: ReturnType<typeof buildCredentialsMock>;
  let adapter: ReturnType<typeof buildAdapterMock>;
  let controller: PaymentGatewayWebhookController;

  beforeEach(() => {
    prisma = buildPrismaMock();
    paymentService = buildPaymentServiceMock();
    credentials = buildCredentialsMock();
    adapter = buildAdapterMock();
    controller = new PaymentGatewayWebhookController(
      prisma as never,
      paymentService as never,
      credentials as never,
      adapter as never,
      buildAdapterMock() as never,
    );
  });

  it("rejects a request with no raw body", async () => {
    await expect(controller.handleMonnifyWebhook(buildRequest({ rawBody: undefined }))).rejects.toThrow(/raw request body/);
    expect(paymentService.resolveGatewayOutcome).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before touching the database", async () => {
    adapter.verifyWebhookSignature.mockReturnValue(false);

    await expect(controller.handleMonnifyWebhook(buildRequest())).rejects.toThrow(/Invalid webhook signature/);
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
    expect(paymentService.resolveGatewayOutcome).not.toHaveBeenCalled();
  });

  it("verifies the signature using credentials for the specific provider being handled, not the active one", async () => {
    await controller.handleMonnifyWebhook(buildRequest());

    expect(credentials.getCredentials).toHaveBeenCalledWith("MONNIFY");
  });

  it("acknowledges gracefully (no crash) when the payload can't be parsed", async () => {
    adapter.parseWebhookPayload.mockReturnValue(null);

    const result = await controller.handleMonnifyWebhook(buildRequest());

    expect(result).toEqual({ received: true });
    expect(paymentService.resolveGatewayOutcome).not.toHaveBeenCalled();
  });

  it("acknowledges gracefully when no invoice matches the reference", async () => {
    prisma.invoice.findUnique.mockResolvedValue(null);

    const result = await controller.handleMonnifyWebhook(buildRequest());

    expect(result).toEqual({ received: true });
    expect(paymentService.resolveGatewayOutcome).not.toHaveBeenCalled();
  });

  it("resolves the payment outcome when signature, payload, and invoice all match", async () => {
    prisma.invoice.findUnique.mockResolvedValue({ id: "invoice-1", gatewayPaymentReference: "INV-1-100" });

    await controller.handleMonnifyWebhook(buildRequest());

    expect(prisma.invoice.findUnique).toHaveBeenCalledWith({ where: { gatewayPaymentReference: "INV-1-100" } });
    expect(paymentService.resolveGatewayOutcome).toHaveBeenCalledWith(
      "invoice-1",
      "MONNIFY",
      expect.objectContaining({ status: "SUCCESSFUL", gatewayTransactionReference: "MNFY|TXN|1" }),
    );
  });

  it("handlePaystackWebhook uses PAYSTACK credentials/provider, not Monnify's", async () => {
    prisma.invoice.findUnique.mockResolvedValue({ id: "invoice-1", gatewayPaymentReference: "INV-1-100" });

    await controller.handlePaystackWebhook(buildRequest({ headers: { "x-paystack-signature": "abc123" } }));

    expect(credentials.getCredentials).toHaveBeenCalledWith("PAYSTACK");
    expect(paymentService.resolveGatewayOutcome).toHaveBeenCalledWith("invoice-1", "PAYSTACK", expect.anything());
  });
});
