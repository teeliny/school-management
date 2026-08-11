import { createHmac, timingSafeEqual } from "node:crypto";
import {
  GatewayTransactionNotFoundError,
  type GatewayTransactionResult,
  type InitTransactionParams,
  type InitTransactionResult,
  type PaymentGatewayAdapter,
  type PaymentGatewayCredentials,
} from "./types";

const SANDBOX_BASE_URL = "https://sandbox.monnify.com";
const LIVE_BASE_URL = "https://api.monnify.com";
const SIGNATURE_HEADER = "monnify-signature";

interface MonnifyEnvelope<T> {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: T;
}

/**
 * Real endpoint shapes confirmed against Monnify's developer documentation
 * (developers.monnify.com) — not guessed. See the Phase 5 Slice 2b plan for
 * the source citations.
 */
export class MonnifyAdapter implements PaymentGatewayAdapter {
  private baseUrl(credentials: PaymentGatewayCredentials): string {
    return credentials.environment === "LIVE"
      ? LIVE_BASE_URL
      : SANDBOX_BASE_URL;
  }

  /**
   * Fetched fresh on every call rather than cached — simplest correct thing
   * at this school's payment volume (one extra HTTP round-trip per
   * checkout-init/verify call); token caching can be added later if it's
   * ever measured as a real cost.
   */
  private async getAccessToken(
    credentials: PaymentGatewayCredentials,
  ): Promise<string> {
    const basicAuth = Buffer.from(
      `${credentials.apiKey}:${credentials.secretKey}`,
    ).toString("base64");
    const response = await fetch(
      `${this.baseUrl(credentials)}/api/v1/auth/login`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${basicAuth}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Monnify login failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as MonnifyEnvelope<{
      accessToken: string;
    }>;
    if (!body.requestSuccessful) {
      throw new Error(`Monnify login failed: ${body.responseMessage}`);
    }
    return body.responseBody.accessToken;
  }

  async initTransaction(
    credentials: PaymentGatewayCredentials,
    params: InitTransactionParams,
  ): Promise<InitTransactionResult> {
    const accessToken = await this.getAccessToken(credentials);
    const response = await fetch(
      `${this.baseUrl(credentials)}/api/v1/merchant/transactions/init-transaction`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: params.amount,
          customerName: params.customerName,
          customerEmail: params.customerEmail,
          paymentReference: params.reference,
          paymentDescription: params.description,
          currencyCode: "NGN",
          contractCode: credentials.contractCode,
          redirectUrl: params.redirectUrl,
          feeBearer: "CLIENT",
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Monnify init-transaction failed: HTTP ${response.status}`,
      );
    }
    const body = (await response.json()) as MonnifyEnvelope<{
      checkoutUrl: string;
    }>;
    if (!body.requestSuccessful) {
      throw new Error(
        `Monnify init-transaction failed: ${body.responseMessage}`,
      );
    }
    return { checkoutUrl: body.responseBody.checkoutUrl };
  }

  async verifyTransaction(
    credentials: PaymentGatewayCredentials,
    reference: string,
  ): Promise<GatewayTransactionResult> {
    const accessToken = await this.getAccessToken(credentials);
    const url = `${this.baseUrl(credentials)}/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(reference)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 404) {
      throw new GatewayTransactionNotFoundError(
        `Monnify has no transaction for reference ${reference}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Monnify transaction query failed: HTTP ${response.status}`,
      );
    }
    const body = (await response.json()) as MonnifyEnvelope<{
      paymentStatus: string;
      amountPaid: number;
      transactionReference: string;
      paidOn: string | null;
      paymentMethod: string;
    }>;
    if (!body.requestSuccessful) {
      throw new Error(
        `Monnify transaction query failed: ${body.responseMessage}`,
      );
    }
    return mapMonnifyResult(body.responseBody);
  }

  verifyWebhookSignature(
    credentials: PaymentGatewayCredentials,
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac("sha512", credentials.secretKey)
      .update(rawBody)
      .digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const actualBuffer = Buffer.from(signatureHeader, "hex");
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  /**
   * The real webhook body (confirmed against a live payload, not just docs)
   * is an envelope — `{ eventType, eventData }` — not the flat transaction
   * shape verifyTransaction's REST response uses; the transaction fields
   * live under `eventData`. Monnify also fires this same URL for unrelated
   * event types (disbursements, refunds, settlements, wallet alerts —
   * developers.monnify.com/docs/webhooks/event-types) whose eventData won't
   * even have a paymentReference, so this only acts on
   * "SUCCESSFUL_TRANSACTION" (the collection-completed event, the only one
   * this integration cares about per FR7.6) and safely ignores every other
   * eventType rather than erroring on its differently-shaped eventData.
   */
  parseWebhookPayload(
    rawBody: Buffer,
  ): (GatewayTransactionResult & { reference: string }) | null {
    try {
      const envelope = JSON.parse(rawBody.toString("utf8")) as {
        eventType?: string;
        eventData?: {
          paymentReference: string;
          paymentStatus: string;
          amountPaid: number;
          transactionReference: string;
          paidOn: string | null;
          paymentMethod: string;
        };
      };
      if (
        envelope.eventType !== "SUCCESSFUL_TRANSACTION" ||
        !envelope.eventData?.paymentReference
      )
        return null;
      return {
        reference: envelope.eventData.paymentReference,
        ...mapMonnifyResult(envelope.eventData),
      };
    } catch {
      return null;
    }
  }
}

export const MONNIFY_SIGNATURE_HEADER = SIGNATURE_HEADER;

function mapMonnifyResult(body: {
  paymentStatus: string;
  amountPaid: number;
  transactionReference: string;
  paidOn: string | null;
  paymentMethod: string;
}): GatewayTransactionResult {
  return {
    status: mapMonnifyStatus(body.paymentStatus),
    amountPaid: body.amountPaid,
    gatewayTransactionReference: body.transactionReference,
    paidAt: body.paidOn ? new Date(body.paidOn) : null,
    channel: body.paymentMethod,
  };
}

// PAID/OVERPAID -> SUCCESSFUL, PENDING -> PENDING, everything else
// (FAILED/CANCELLED/ABANDONED/EXPIRED/REVERSED) -> FAILED — reversal-
// specific handling is out of scope, PRD doesn't specify a reversal
// workflow beyond the PaymentStatus.REVERSED enum value existing.
function mapMonnifyStatus(
  paymentStatus: string,
): "SUCCESSFUL" | "PENDING" | "FAILED" {
  if (paymentStatus === "PAID" || paymentStatus === "OVERPAID")
    return "SUCCESSFUL";
  if (paymentStatus === "PENDING") return "PENDING";
  return "FAILED";
}
