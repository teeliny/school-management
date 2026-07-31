import { createHash, randomBytes } from "node:crypto";

/**
 * Single-use token pattern shared by Invitation and (later) password reset:
 * the raw token is only ever handed to the recipient (in an emailed link);
 * only its hash is persisted, so a database read alone can never produce a
 * usable token (PRD §3.1a).
 */
export function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
