import { Injectable } from "@nestjs/common";
import { AbilityBuilder, createMongoAbility, MongoAbility } from "@casl/ability";
import type { RequestUser } from "../auth/jwt.strategy";

/**
 * PRD §5 permission matrix, ARCHITECTURE.md §7: this is the mechanism that
 * makes role-scoped rules enforceable in one place instead of re-implemented
 * per-endpoint — the boundary that actually matters in a single-tenant app,
 * since the tenant boundary is handled for free by deployment isolation.
 *
 * Phase 1 keeps the rule set intentionally small (only what Identity &
 * Academic Structure need); every later phase adds rules here rather than
 * inventing its own ad-hoc auth pattern.
 */
export type Action = "manage" | "invite";
export type Subject = "all" | "AcademicStructure" | "Invitation";
export type AppAbility = MongoAbility<[Action, Subject | { invitedRole: string }]>;

@Injectable()
export class AbilityFactory {
  createForUser(user: RequestUser): AppAbility {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (user.roles.includes("SUPER_ADMIN")) {
      can("manage", "all");
    } else if (user.roles.includes("ADMIN")) {
      can("manage", "AcademicStructure");
      can("invite", "Invitation");
      // PRD FR1.2: appointing an Admin is an owner-only action.
      cannot("invite", "Invitation", { invitedRole: "ADMIN" });
    }

    return build();
  }
}
