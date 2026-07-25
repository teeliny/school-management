import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { EnvelopeEncryptionService } from "./envelope-encryption.service";

describe("EnvelopeEncryptionService", () => {
  const key = randomBytes(32).toString("base64");
  const config = { getOrThrow: () => key } as unknown as ConfigService;

  it("round-trips a plaintext value", () => {
    const service = new EnvelopeEncryptionService(config);
    const encrypted = service.encrypt("monnify-secret-key");

    expect(encrypted).not.toBe("monnify-secret-key");
    expect(service.decrypt(encrypted)).toBe("monnify-secret-key");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const service = new EnvelopeEncryptionService(config);
    const a = service.encrypt("same-input");
    const b = service.encrypt("same-input");

    expect(a).not.toBe(b);
  });

  it("rejects a master key that isn't 32 bytes", () => {
    const badConfig = {
      getOrThrow: () => Buffer.from("too-short").toString("base64"),
    } as unknown as ConfigService;

    expect(() => new EnvelopeEncryptionService(badConfig)).toThrow(/32 bytes/);
  });
});
