/**
 * ARCHITECTURE.md §5/§10, Phase 5 Slice 2b: the swap-later shape for payment
 * gateways, same "interface first, provider second" principle as
 * StorageAdapter — apps/api's FeesModule (checkout + webhook) and
 * apps/worker's reconciliation sweep both call only this interface, never a
 * provider SDK directly.
 *
 * Lives in @school/types (not apps/api or apps/worker) because both
 * processes need the exact same adapter logic — the reconciliation sweep
 * (apps/worker) must verify a transaction and parse a webhook payload
 * identically to how apps/api's webhook handler does, or the two could
 * silently drift. Framework-free (no NestJS, no Prisma — only `fetch` and
 * `node:crypto`) so this stays a plain, directly-testable class either app
 * can wrap in its own thin DI provider.
 */
export interface PaymentGatewayCredentials {
  apiKey: string;
  secretKey: string;
  contractCode?: string;
  environment: "SANDBOX" | "LIVE";
}

export interface InitTransactionParams {
  /** Naira — each adapter converts internally (Paystack wants kobo). */
  amount: number;
  reference: string;
  customerEmail: string;
  customerName: string;
  description: string;
  redirectUrl?: string;
}

export interface InitTransactionResult {
  checkoutUrl: string;
}

export type GatewayTransactionStatus = "SUCCESSFUL" | "PENDING" | "FAILED";

export interface GatewayTransactionResult {
  status: GatewayTransactionStatus;
  amountPaid: number;
  gatewayTransactionReference: string;
  paidAt: Date | null;
  /** Provider's own channel string (e.g. "CARD", "card", "bank_transfer") — mapped to PaymentMethod by the caller. */
  channel: string;
}

export interface PaymentGatewayAdapter {
  initTransaction(credentials: PaymentGatewayCredentials, params: InitTransactionParams): Promise<InitTransactionResult>;
  verifyTransaction(credentials: PaymentGatewayCredentials, reference: string): Promise<GatewayTransactionResult>;
  /**
   * Must be checked against the raw, unparsed request body bytes — a
   * re-serialized JSON object can have different whitespace/key ordering
   * than what the gateway actually signed, and the signature will silently
   * fail to match. Uses a timing-safe comparison, not `===`.
   */
  verifyWebhookSignature(credentials: PaymentGatewayCredentials, rawBody: Buffer, signatureHeader: string | undefined): boolean;
  parseWebhookPayload(rawBody: Buffer): (GatewayTransactionResult & { reference: string }) | null;
}
