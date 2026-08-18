/**
 * Mirrors the Prisma `PaymentMethod` enum's four `GATEWAY_*` values —
 * needed by both apps/api's webhook handler and apps/worker's
 * reconciliation sweep, which must normalize a provider's own channel
 * vocabulary ("CARD"/"card", "ACCOUNT_TRANSFER"/"bank_transfer", ...) onto
 * the same PaymentMethod value identically, or the two could silently
 * drift. Framework-free (returns a plain string union, not the actual
 * Prisma enum) so this stays importable from @school/types; each app casts
 * the result to its own generated `PaymentMethod` type, which shares these
 * same literal values.
 */
export type GatewayPaymentMethod = "GATEWAY_CARD" | "GATEWAY_TRANSFER" | "GATEWAY_USSD" | "GATEWAY_RESERVED_ACCOUNT";

export function mapChannelToPaymentMethod(channel: string): GatewayPaymentMethod {
  const normalized = channel.toUpperCase();
  if (normalized === "CARD") return "GATEWAY_CARD";
  if (normalized === "ACCOUNT_TRANSFER" || normalized === "BANK_TRANSFER" || normalized === "BANK") return "GATEWAY_TRANSFER";
  if (normalized === "USSD") return "GATEWAY_USSD";
  if (normalized === "DEDICATED_NUBAN" || normalized === "RESERVED_ACCOUNT") return "GATEWAY_RESERVED_ACCOUNT";
  return "GATEWAY_CARD";
}
