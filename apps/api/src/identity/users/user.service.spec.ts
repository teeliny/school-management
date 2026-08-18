import { UserService } from "./user.service";

describe("UserService.normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(UserService.normalizeEmail("  Proprietor@Example.COM  ")).toBe("proprietor@example.com");
  });

  it("is idempotent", () => {
    const once = UserService.normalizeEmail("Mixed@Case.com");
    expect(UserService.normalizeEmail(once)).toBe(once);
  });
});
