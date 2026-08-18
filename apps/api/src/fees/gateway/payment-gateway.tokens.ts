// Same DI-token pattern as apps/worker's STORAGE_ADAPTER — a plain Symbol,
// bound to a concrete provider via NestJS DI rather than importing a
// concrete class directly anywhere FeesModule consumes it.
export const MONNIFY_ADAPTER = Symbol("MONNIFY_ADAPTER");
export const PAYSTACK_ADAPTER = Symbol("PAYSTACK_ADAPTER");

// Whichever concrete adapter PAYMENT_GATEWAY_PROVIDER (env var) selects for
// NEW checkouts (ARCHITECTURE.md §5/§10) — webhook handling and
// reconciliation always resolve the adapter matching a specific Payment's
// own recorded gatewayProvider instead, never this token.
export const PAYMENT_GATEWAY_ADAPTER = Symbol("PAYMENT_GATEWAY_ADAPTER");
