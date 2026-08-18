import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

/**
 * Duplicated from apps/api/src/common/crypto/envelope-encryption.service.ts
 * — same "duplicate per app, don't cross-import" precedent as PrismaService/
 * parseCorsOrigins(). apps/worker needs this to decrypt PaymentGatewayConfig
 * credentials for the payment-reconciliation sweep (Phase 5 Slice 2b), the
 * same way apps/api's PaymentGatewayCredentialsService does.
 */
@Injectable()
export class EnvelopeEncryptionService {
  private readonly masterKey: Buffer;

  constructor(config: ConfigService) {
    const keyBase64 = config.getOrThrow<string>("ENCRYPTION_MASTER_KEY");
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) {
      throw new Error(
        "ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes (AES-256). " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
      );
    }
    this.masterKey = key;
  }

  /** Returns a single self-contained string: base64(iv).base64(authTag).base64(ciphertext) */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
  }

  decrypt(encrypted: string): string {
    const [ivB64, authTagB64, ciphertextB64] = encrypted.split(".");
    if (!ivB64 || !authTagB64 || !ciphertextB64) {
      throw new Error("Malformed envelope-encrypted value");
    }

    const decipher = createDecipheriv(ALGORITHM, this.masterKey, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));

    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);

    return plaintext.toString("utf8");
  }
}
