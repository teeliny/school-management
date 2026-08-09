import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { AuditInterceptor } from "./audit.interceptor";

function buildContext(overrides: {
  method?: string;
  params?: Record<string, string>;
  user?: { id: string };
  routePath?: string;
}): ExecutionContext {
  const request = {
    method: overrides.method ?? "POST",
    params: overrides.params ?? {},
    user: overrides.user,
    route: { path: overrides.routePath ?? "/fee-structures" },
    url: overrides.routePath ?? "/fee-structures",
  };
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
  } as unknown as ExecutionContext;
}

function buildHandler(response: unknown): CallHandler {
  return { handle: () => of(response) };
}

describe("AuditInterceptor", () => {
  it("passes through untouched when no @Audited metadata is present", async () => {
    const reflector = { get: jest.fn().mockReturnValue(undefined) };
    const prisma = { auditLog: { create: jest.fn() } };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);

    const result = await lastValueFrom(
      interceptor.intercept(buildContext({}), buildHandler({ id: "x" })),
    );

    expect(result).toEqual({ id: "x" });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("logs CREATE with no before-fetch for a POST, using the response as `after`", async () => {
    const reflector = { get: jest.fn().mockReturnValue({ entityType: "FeeStructure", model: "feeStructure" }) };
    const findUnique = jest.fn();
    const create = jest.fn().mockResolvedValue({});
    const prisma = { feeStructure: { findUnique }, auditLog: { create } };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);
    const context = buildContext({ method: "POST", user: { id: "user-1" }, routePath: "/fee-structures" });

    await lastValueFrom(interceptor.intercept(context, buildHandler({ id: "fs-1", name: "Tuition" })));

    expect(findUnique).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: "user-1",
        action: "CREATE",
        entityType: "FeeStructure",
        entityId: "fs-1",
        before: undefined,
        after: { id: "fs-1", name: "Tuition" },
        route: "POST /fee-structures",
      },
    });
  });

  it("captures a before snapshot for a PATCH with an :id param and a model", async () => {
    const reflector = { get: jest.fn().mockReturnValue({ entityType: "FeeStructure", model: "feeStructure" }) };
    const findUnique = jest.fn().mockResolvedValue({ id: "fs-1", name: "Old Name" });
    const create = jest.fn().mockResolvedValue({});
    const prisma = { feeStructure: { findUnique }, auditLog: { create } };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);
    const context = buildContext({
      method: "PATCH",
      params: { id: "fs-1" },
      user: { id: "user-1" },
      routePath: "/fee-structures/:id",
    });

    await lastValueFrom(interceptor.intercept(context, buildHandler({ id: "fs-1", name: "New Name" })));

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "fs-1" } });
    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: "user-1",
        action: "UPDATE",
        entityType: "FeeStructure",
        entityId: "fs-1",
        before: { id: "fs-1", name: "Old Name" },
        after: { id: "fs-1", name: "New Name" },
        route: "PATCH /fee-structures/:id",
      },
    });
  });

  it("derives a verb-based action from a known trailing route segment", async () => {
    const reflector = { get: jest.fn().mockReturnValue({ entityType: "DiscountRequest", model: "discountRequest" }) };
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      discountRequest: { findUnique: jest.fn().mockResolvedValue(null) },
      auditLog: { create },
    };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);
    const context = buildContext({
      method: "PATCH",
      params: { id: "dr-1" },
      user: { id: "user-1" },
      routePath: "/discount-requests/:id/approve",
    });

    await lastValueFrom(interceptor.intercept(context, buildHandler({ id: "dr-1" })));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "APPROVE" }) }));
  });

  it("falls back to a null actor for an unauthenticated (webhook) request", async () => {
    const reflector = { get: jest.fn().mockReturnValue({ entityType: "Payment" }) };
    const create = jest.fn().mockResolvedValue({});
    const prisma = { auditLog: { create } };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);
    const context = buildContext({ method: "POST", routePath: "/payment-gateways/webhooks/monnify" });

    await lastValueFrom(interceptor.intercept(context, buildHandler({ received: true })));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorUserId: null }) }));
  });

  it("never breaks the real response when the audit-log write itself fails", async () => {
    const reflector = { get: jest.fn().mockReturnValue({ entityType: "FeeStructure" }) };
    const create = jest.fn().mockRejectedValue(new Error("db down"));
    const prisma = { auditLog: { create } };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);
    const context = buildContext({ method: "POST", user: { id: "user-1" }, routePath: "/fee-structures" });

    const result = await lastValueFrom(interceptor.intercept(context, buildHandler({ id: "fs-1" })));

    expect(result).toEqual({ id: "fs-1" });
  });
});
