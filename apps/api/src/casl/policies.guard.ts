import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AbilityFactory } from "./ability.factory";
import { CHECK_POLICIES_KEY, PolicyHandler } from "./check-policies.decorator";

/**
 * Pairs with JwtAuthGuard: JwtAuthGuard establishes *who* the request is
 * from, this guard establishes *what they're allowed to do*, via the
 * `@CheckPolicies(...)` handlers declared on the route (ARCHITECTURE.md §7).
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handlers =
      this.reflector.getAllAndOverride<PolicyHandler[]>(CHECK_POLICIES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (handlers.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    const ability = this.abilityFactory.createForUser(user);

    const allowed = handlers.every((handler) => handler(ability));
    if (!allowed) throw new ForbiddenException("Insufficient permissions");
    return true;
  }
}
