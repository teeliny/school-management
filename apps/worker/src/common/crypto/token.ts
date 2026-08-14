import { createHash, randomBytes } from "node:crypto";

/**
 * Duplicated from apps/api/src/common/crypto/token.ts (same per-app
 * duplication precedent as PrismaService/cors.ts) — single-use opaque token
 * pattern: only a token's hash is ever persisted, so a database read alone
 * can never produce a usable token. Used here for TermReportCard's
 * verificationTokenHash (the QR-code verification link).
 */
export function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
