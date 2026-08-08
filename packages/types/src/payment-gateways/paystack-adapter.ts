import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  GatewayTransactionResult,
  InitTransactionParams,
  InitTransactionResult,
  PaymentGatewayAdapter,
  PaymentGatewayCredentials,
} from "./types";

const BASE_URL = "https://api.paystack.co";
const SIGNATURE_HEADER = "x-paystack-signature";

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

/**
 * Real endpoint shapes confirmed against Paystack's developer documentation
 * (paystack.com/docs) — not guessed. Same HMAC-SHA512-over-the-raw-body
 * signature scheme as Monnify, just a different header name — see the
 * Phase 5 Slice 2b plan for source citations.
 */
export class PaystackAdapter implements PaymentGatewayAdapter {
  async initTransaction(credentials: PaymentGatewayCredentials, params: InitTransactionParams): Promise<InitTransactionResult> {
    const response = await fetch(`${BASE_URL}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Paystack wants kobo, not Naira — the one place this adapter
        // converts; every other layer of this app deals in Naira only.
        amount: Math.round(params.amount * 100),
        email: params.customerEmail,
        reference: params.reference,
        callback_url: params.redirectUrl,
      }),
    });
    if (!response.ok) {
      throw new Error(`Paystack transaction/initialize failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as PaystackEnvelope<{ authorization_url: string }>;
    if (!body.status) {
      throw new Error(`Paystack transaction/initialize failed: ${body.message}`);
    }
    return { checkoutUrl: body.data.authorization_url };
  }

  async verifyTransaction(credentials: PaymentGatewayCredentials, reference: string): Promise<GatewayTransactionResult> {
    const response = await fetch(`${BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${credentials.secretKey}` },
    });
    if (!response.ok) {
      throw new Error(`Paystack transaction/verify failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as PaystackEnvelope<{
      status: string;
      amount: number;
      id: number | string;
      paid_at: string | null;
      channel: string;
    }>;
    if (!body.status) {
      throw new Error(`Paystack transaction/verify failed: ${body.message}`);
    }
    return mapPaystackResult(body.data);
  }

  verifyWebhookSignature(credentials: PaymentGatewayCredentials, rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac("sha512", credentials.secretKey).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(signatureHeader, "hex");
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  parseWebhookPayload(rawBody: Buffer): (GatewayTransactionResult & { reference: string }) | null {
    try {
      const payload = JSON.parse(rawBody.toString("utf8")) as {
        event: string;
        data: { reference: string; amount: number; status: string; paid_at: string | null; channel: string; id: number | string };
      };
      if (!payload.data?.reference) return null;
      return { reference: payload.data.reference, ...mapPaystackResult(payload.data) };
    } catch {
      return null;
    }
  }
}

export const PAYSTACK_SIGNATURE_HEADER = SIGNATURE_HEADER;

function mapPaystackResult(data: { status: string; amount: number; id: number | string; paid_at: string | null; channel: string }): GatewayTransactionResult {
  return {
    status: mapPaystackStatus(data.status),
    // Paystack reports amount in kobo — convert back to Naira so the rest
    // of this app never has to think about the unit difference between
    // providers.
    amountPaid: data.amount / 100,
    gatewayTransactionReference: String(data.id),
    paidAt: data.paid_at ? new Date(data.paid_at) : null,
    channel: data.channel,
  };
}

// "success" -> SUCCESSFUL, "abandoned"/"pending" -> PENDING, everything
// else ("failed", ...) -> FAILED.
function mapPaystackStatus(status: string): "SUCCESSFUL" | "PENDING" | "FAILED" {
  if (status === "success") return "SUCCESSFUL";
  if (status === "abandoned" || status === "pending") return "PENDING";
  return "FAILED";
}
