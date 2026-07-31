import { generateRawToken, hashToken } from "./token";

describe("token", () => {
  it("generates a different raw token each time", () => {
    expect(generateRawToken()).not.toBe(generateRawToken());
  });

  it("hashes deterministically (same input -> same hash)", () => {
    const raw = generateRawToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashToken(generateRawToken())).not.toBe(hashToken(generateRawToken()));
  });
});
