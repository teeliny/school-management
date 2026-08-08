import { createHmac } from "node:crypto";
import { PaystackAdapter, PAYSTACK_SIGNATURE_HEADER, type PaymentGatewayCredentials } from "@school/types";

const CREDENTIALS: PaymentGatewayCredentials = {
  apiKey: "pk_test_key",
  secretKey: "sk_test_secret",
  environment: "SANDBOX",
};

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe("PaystackAdapter", () => {
  let adapter: PaystackAdapter;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    adapter = new PaystackAdapter();
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("initTransaction converts Naira to kobo and posts to transaction/initialize", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ status: true, message: "Authorization URL created", data: { authorization_url: "https://checkout.paystack.com/abc" } }),
    );

    const result = await adapter.initTransaction(CREDENTIALS, {
      amount: 5000,
      reference: "INV-1-123",
      customerEmail: "parent@example.com",
      customerName: "Jane Doe",
      description: "School fees payment",
    });

    expect(result.checkoutUrl).toBe("https://checkout.paystack.com/abc");

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_secret");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ amount: 500000, email: "parent@example.com", reference: "INV-1-123" });
  });

  it("uses the same base URL regardless of environment (Paystack routes by key prefix, not host)", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ status: true, message: "ok", data: { authorization_url: "https://checkout.paystack.com/x" } }),
    );

    await adapter.initTransaction(
      { ...CREDENTIALS, environment: "LIVE" },
      { amount: 1000, reference: "INV-2-1", customerEmail: "a@b.com", customerName: "A B", description: "x" },
    );

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
  });

  it.each([
    ["success", "SUCCESSFUL"],
    ["abandoned", "PENDING"],
    ["pending", "PENDING"],
    ["failed", "FAILED"],
  ])("verifyTransaction maps status %s to %s", async (paystackStatus, expectedStatus) => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        status: true,
        message: "ok",
        data: { status: paystackStatus, amount: 500000, id: 123456, paid_at: "2026-08-08T10:00:00.000Z", channel: "card" },
      }),
    );

    const result = await adapter.verifyTransaction(CREDENTIALS, "INV-1-123");

    expect(result.status).toBe(expectedStatus);
    expect(result.gatewayTransactionReference).toBe("123456");
    // 500000 kobo -> 5000 Naira.
    expect(result.amountPaid).toBe(5000);
  });

  it("verifyTransaction requests the correct endpoint", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ status: true, message: "ok", data: { status: "success", amount: 100, id: 1, paid_at: null, channel: "card" } }),
    );

    await adapter.verifyTransaction(CREDENTIALS, "INV-1-123");

    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe("https://api.paystack.co/transaction/verify/INV-1-123");
  });

  describe("verifyWebhookSignature", () => {
    const rawBody = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "INV-1-123" } }));

    it("accepts a correctly signed payload", () => {
      const signature = createHmac("sha512", CREDENTIALS.secretKey).update(rawBody).digest("hex");
      expect(adapter.verifyWebhookSignature(CREDENTIALS, rawBody, signature)).toBe(true);
    });

    it("rejects a tampered payload", () => {
      const signature = createHmac("sha512", CREDENTIALS.secretKey).update(rawBody).digest("hex");
      const tamperedBody = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "INV-9-999" } }));
      expect(adapter.verifyWebhookSignature(CREDENTIALS, tamperedBody, signature)).toBe(false);
    });

    it("rejects a missing signature header", () => {
      expect(adapter.verifyWebhookSignature(CREDENTIALS, rawBody, undefined)).toBe(false);
    });

    it("uses the documented x-paystack-signature header name", () => {
      expect(PAYSTACK_SIGNATURE_HEADER).toBe("x-paystack-signature");
    });
  });

  describe("parseWebhookPayload", () => {
    it("parses a realistic charge.success webhook payload", () => {
      const payload = {
        event: "charge.success",
        data: { id: 987654, reference: "INV-1-123", amount: 500000, status: "success", paid_at: "2026-08-08T10:00:00.000Z", channel: "bank_transfer" },
      };
      const result = adapter.parseWebhookPayload(Buffer.from(JSON.stringify(payload)));

      expect(result).toMatchObject({
        reference: "INV-1-123",
        status: "SUCCESSFUL",
        amountPaid: 5000,
        gatewayTransactionReference: "987654",
        channel: "bank_transfer",
      });
    });

    it("returns null for malformed JSON", () => {
      expect(adapter.parseWebhookPayload(Buffer.from("not json"))).toBeNull();
    });

    it("returns null when data.reference is missing", () => {
      expect(adapter.parseWebhookPayload(Buffer.from(JSON.stringify({ event: "charge.success", data: {} })))).toBeNull();
    });
  });
});
