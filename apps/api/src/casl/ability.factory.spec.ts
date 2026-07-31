import { subject } from "@casl/ability";
import { AbilityFactory } from "./ability.factory";
import type { RequestUser } from "../auth/jwt.strategy";

describe("AbilityFactory", () => {
  const factory = new AbilityFactory();

  function userWith(...roles: string[]): RequestUser {
    return { id: "user-1", roles };
  }

  it("SUPER_ADMIN can manage anything", () => {
    const ability = factory.createForUser(userWith("SUPER_ADMIN"));
    expect(ability.can("manage", "AcademicStructure")).toBe(true);
    expect(ability.can("invite", "Invitation")).toBe(true);
    expect(ability.can("invite", subject("Invitation", { invitedRole: "ADMIN" }))).toBe(true);
  });

  it("ADMIN can manage academic structure and invite Staff/Parent, but not Admin", () => {
    const ability = factory.createForUser(userWith("ADMIN"));
    expect(ability.can("manage", "AcademicStructure")).toBe(true);
    expect(ability.can("invite", subject("Invitation", { invitedRole: "STAFF" }))).toBe(true);
    expect(ability.can("invite", subject("Invitation", { invitedRole: "PARENT" }))).toBe(true);
    // PRD FR1.2: appointing an Admin is an owner-only action.
    expect(ability.can("invite", subject("Invitation", { invitedRole: "ADMIN" }))).toBe(false);
  });

  it("STAFF/PARENT/STUDENT have no Phase 1 permissions", () => {
    for (const role of ["STAFF", "PARENT", "STUDENT"]) {
      const ability = factory.createForUser(userWith(role));
      expect(ability.can("manage", "AcademicStructure")).toBe(false);
      expect(ability.can("invite", "Invitation")).toBe(false);
    }
  });

  it("a user with no roles has no permissions", () => {
    const ability = factory.createForUser(userWith());
    expect(ability.can("manage", "AcademicStructure")).toBe(false);
  });
});
