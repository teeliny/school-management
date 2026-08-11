import { createHmac } from "node:crypto";
import {
  GatewayTransactionNotFoundError,
  MonnifyAdapter,
  MONNIFY_SIGNATURE_HEADER,
  type PaymentGatewayCredentials,
} from "@school/types/payment-gateways";

const CREDENTIALS: PaymentGatewayCredentials = {
  apiKey: "MK_TEST_KEY",
  secretKey: "test-secret",
  contractCode: "12345",
  environment: "SANDBOX",
};

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe("MonnifyAdapter", () => {
  let adapter: MonnifyAdapter;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    adapter = new MonnifyAdapter();
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("initTransaction logs in then calls init-transaction against the sandbox base URL", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ requestSuccessful: true, responseBody: { accessToken: "access-tok" } }))
      .mockResolvedValueOnce(
        mockFetchResponse({ requestSuccessful: true, responseBody: { checkoutUrl: "https://sandbox.monnify.com/checkout/abc" } }),
      );

    const result = await adapter.initTransaction(CREDENTIALS, {
      amount: 5000,
      reference: "INV-1-123",
      customerEmail: "parent@example.com",
      customerName: "Jane Doe",
      description: "School fees payment",
    });

    expect(result.checkoutUrl).toBe("https://sandbox.monnify.com/checkout/abc");

    const [loginUrl, loginInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe("https://sandbox.monnify.com/api/v1/auth/login");
    expect(loginInit.method).toBe("POST");
    expect((loginInit.headers as Record<string, string>).Authorization).toMatch(/^Basic /);

    const [initUrl, initInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(initUrl).toBe("https://sandbox.monnify.com/api/v1/merchant/transactions/init-transaction");
    expect((initInit.headers as Record<string, string>).Authorization).toBe("Bearer access-tok");
    const body = JSON.parse(initInit.body as string);
    expect(body).toMatchObject({
      amount: 5000,
      paymentReference: "INV-1-123",
      customerEmail: "parent@example.com",
      currencyCode: "NGN",
      contractCode: "12345",
    });
  });

  it("uses the live base URL when environment is LIVE", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ requestSuccessful: true, responseBody: { accessToken: "tok" } }))
      .mockResolvedValueOnce(mockFetchResponse({ requestSuccessful: true, responseBody: { checkoutUrl: "https://api.monnify.com/checkout/x" } }));

    await adapter.initTransaction(
      { ...CREDENTIALS, environment: "LIVE" },
      { amount: 1000, reference: "INV-2-1", customerEmail: "a@b.com", customerName: "A B", description: "x" },
    );

    const [loginUrl] = fetchSpy.mock.calls[0] as [string];
    expect(loginUrl).toBe("https://api.monnify.com/api/v1/auth/login");
  });

  it.each([
    ["PAID", "SUCCESSFUL"],
    ["OVERPAID", "SUCCESSFUL"],
    ["PENDING", "PENDING"],
    ["ABANDONED", "FAILED"],
    ["FAILED", "FAILED"],
    ["EXPIRED", "FAILED"],
  ])("verifyTransaction maps paymentStatus %s to %s", async (paymentStatus, expectedStatus) => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ requestSuccessful: true, responseBody: { accessToken: "tok" } }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          requestSuccessful: true,
          responseBody: {
            paymentStatus,
            amountPaid: 5000,
            transactionReference: "MNFY|TXN|123",
            paidOn: "2026-08-08 10:00:00.0",
            paymentMethod: "CARD",
          },
        }),
      );

    const result = await adapter.verifyTransaction(CREDENTIALS, "INV-1-123");

    expect(result.status).toBe(expectedStatus);
    expect(result.gatewayTransactionReference).toBe("MNFY|TXN|123");
    expect(result.amountPaid).toBe(5000);
  });

  it("verifyTransaction queries by paymentReference on the v2 query endpoint", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ requestSuccessful: true, responseBody: { accessToken: "tok" } }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          requestSuccessful: true,
          responseBody: { paymentStatus: "PAID", amountPaid: 100, transactionReference: "ref", paidOn: null, paymentMethod: "CARD" },
        }),
      );

    await adapter.verifyTransaction(CREDENTIALS, "INV-1-123");

    const [url] = fetchSpy.mock.calls[1] as [string];
    expect(url).toBe("https://sandbox.monnify.com/api/v2/merchant/transactions/query?paymentReference=INV-1-123");
  });

  it("verifyTransaction throws GatewayTransactionNotFoundError on a 404 (Monnify has no such transaction)", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ requestSuccessful: true, responseBody: { accessToken: "tok" } }))
      .mockResolvedValueOnce(
        mockFetchResponse({ requestSuccessful: false, responseMessage: "not found" }, false, 404),
      );

    await expect(adapter.verifyTransaction(CREDENTIALS, "INV-1-123")).rejects.toThrow(GatewayTransactionNotFoundError);
  });

  it("verifyTransaction throws a plain Error on a non-404 failure, not GatewayTransactionNotFoundError", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ requestSuccessful: true, responseBody: { accessToken: "tok" } }))
      .mockResolvedValueOnce(mockFetchResponse({}, false, 500));

    await expect(adapter.verifyTransaction(CREDENTIALS, "INV-1-123")).rejects.not.toBeInstanceOf(
      GatewayTransactionNotFoundError,
    );
  });

  describe("verifyWebhookSignature", () => {
    const rawBody = Buffer.from(JSON.stringify({ paymentReference: "INV-1-123", paymentStatus: "PAID" }));

    it("accepts a correctly signed payload", () => {
      const signature = createHmac("sha512", CREDENTIALS.secretKey).update(rawBody).digest("hex");
      expect(adapter.verifyWebhookSignature(CREDENTIALS, rawBody, signature)).toBe(true);
    });

    it("rejects a tampered payload", () => {
      const signature = createHmac("sha512", CREDENTIALS.secretKey).update(rawBody).digest("hex");
      const tamperedBody = Buffer.from(JSON.stringify({ paymentReference: "INV-1-123", paymentStatus: "FAILED" }));
      expect(adapter.verifyWebhookSignature(CREDENTIALS, tamperedBody, signature)).toBe(false);
    });

    it("rejects a signature computed with the wrong secret", () => {
      const signature = createHmac("sha512", "wrong-secret").update(rawBody).digest("hex");
      expect(adapter.verifyWebhookSignature(CREDENTIALS, rawBody, signature)).toBe(false);
    });

    it("rejects a missing signature header", () => {
      expect(adapter.verifyWebhookSignature(CREDENTIALS, rawBody, undefined)).toBe(false);
    });

    it("uses the documented monnify-signature header name", () => {
      expect(MONNIFY_SIGNATURE_HEADER).toBe("monnify-signature");
    });
  });

  describe("parseWebhookPayload", () => {
    it("parses a realistic Monnify webhook payload (eventType/eventData envelope, confirmed against a live payload)", () => {
      const payload = {
        eventType: "SUCCESSFUL_TRANSACTION",
        eventData: {
          transactionReference: "MNFY|TXN|456",
          paymentReference: "INV-1-123",
          amountPaid: 5000,
          paymentStatus: "PAID",
          paidOn: "2026-08-08 10:00:00.0",
          paymentMethod: "ACCOUNT_TRANSFER",
        },
      };
      const result = adapter.parseWebhookPayload(Buffer.from(JSON.stringify(payload)));

      expect(result).toMatchObject({
        reference: "INV-1-123",
        status: "SUCCESSFUL",
        amountPaid: 5000,
        gatewayTransactionReference: "MNFY|TXN|456",
        channel: "ACCOUNT_TRANSFER",
      });
    });

    it("ignores an unrelated eventType (e.g. a disbursement/refund/wallet event) instead of erroring on its different shape", () => {
      const payload = {
        eventType: "SUCCESSFUL_DISBURSEMENT",
        eventData: { reference: "DSB-1", amount: 5000, status: "SUCCESS" },
      };
      expect(adapter.parseWebhookPayload(Buffer.from(JSON.stringify(payload)))).toBeNull();
    });

    it("returns null for a flat (non-enveloped) payload — real Monnify webhooks are never flat", () => {
      const payload = {
        transactionReference: "MNFY|TXN|456",
        paymentReference: "INV-1-123",
        amountPaid: 5000,
        paymentStatus: "PAID",
        paidOn: null,
        paymentMethod: "CARD",
      };
      expect(adapter.parseWebhookPayload(Buffer.from(JSON.stringify(payload)))).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      expect(adapter.parseWebhookPayload(Buffer.from("not json"))).toBeNull();
    });

    it("returns null when eventData.paymentReference is missing even for a SUCCESSFUL_TRANSACTION event", () => {
      const payload = { eventType: "SUCCESSFUL_TRANSACTION", eventData: { paymentStatus: "PAID" } };
      expect(adapter.parseWebhookPayload(Buffer.from(JSON.stringify(payload)))).toBeNull();
    });
  });
});
