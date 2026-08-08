// Duplicated from apps/api/src/fees/gateway/payment-gateway.tokens.ts — the
// reconciliation sweep needs both concrete adapters (it always resolves the
// one matching each stuck Payment's own gatewayProvider, never an "active"
// selection), so there's no PAYMENT_GATEWAY_ADAPTER token here.
export const MONNIFY_ADAPTER = Symbol("MONNIFY_ADAPTER");
export const PAYSTACK_ADAPTER = Symbol("PAYSTACK_ADAPTER");
