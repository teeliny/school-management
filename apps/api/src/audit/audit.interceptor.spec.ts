import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { AuditInterceptor } from "./audit.interceptor";

function buildContext(overrides: {
  method?: string;
  params?: Record<string, string>;
  user?: { id: string };
  routePath?: string;
  auditAction?: string;
  auditBefore?: unknown;
}): ExecutionContext {
  const request = {
    method: overrides.method ?? "POST",
    params: overrides.params ?? {},
    user: overrides.user,
    route: { path: overrides.routePath ?? "/fee-structures" },
    url: overrides.routePath ?? "/fee-structures",
    ...("auditAction" in overrides ? { auditAction: overrides.auditAction } : {}),
    ...("auditBefore" in overrides ? { auditBefore: overrides.auditBefore } : {}),
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

  it("derives SWAP for a duty/invigilation-assignment swap, not the generic PATCH default of UPDATE", async () => {
    const reflector = { get: jest.fn().mockReturnValue({ entityType: "DutyAssignment", model: "dutyAssignment" }) };
    const create = jest.fn().mockResolvedValue({});
    const prisma = { dutyAssignment: { findUnique: jest.fn().mockResolvedValue(null) }, auditLog: { create } };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);
    const context = buildContext({
      method: "PATCH",
      params: { id: "da-1" },
      user: { id: "user-1" },
      routePath: "/duty-assignments/:id/swap",
    });

    await lastValueFrom(interceptor.intercept(context, buildHandler({ id: "da-1" })));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "SWAP" }) }));
  });

  it("derives RESET-PASSWORD for a password reset, not the generic POST default of CREATE", async () => {
    const reflector = { get: jest.fn().mockReturnValue({ entityType: "User" }) };
    const create = jest.fn().mockResolvedValue({});
    const prisma = { auditLog: { create } };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);
    const context = buildContext({ method: "POST", routePath: "/auth/reset-password" });

    await lastValueFrom(interceptor.intercept(context, buildHandler({ id: "user-1" })));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "RESET-PASSWORD" }) }));
  });

  it("prefers a handler-supplied auditAction/auditBefore override over its own derivation", async () => {
    const reflector = { get: jest.fn().mockReturnValue({ entityType: "ScoreEntry", model: "scoreEntry" }) };
    const findUnique = jest.fn();
    const create = jest.fn().mockResolvedValue({});
    const prisma = { scoreEntry: { findUnique }, auditLog: { create } };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);
    const priorRow = { id: "se-1", score: 10 };
    const context = buildContext({
      method: "POST",
      user: { id: "user-1" },
      routePath: "/score-entries",
      auditAction: "UPDATE",
      auditBefore: priorRow,
    });

    await lastValueFrom(interceptor.intercept(context, buildHandler({ id: "se-1", score: 15 })));

    // The generic :id-param before-fetch never runs for this route (no :id) —
    // the override supplies `before` directly instead.
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      data: {
        actorUserId: "user-1",
        action: "UPDATE",
        entityType: "ScoreEntry",
        entityId: "se-1",
        before: priorRow,
        after: { id: "se-1", score: 15 },
        route: "POST /score-entries",
      },
    });
  });

  it("prefers an explicit auditBefore: null override over the interceptor's own model+id fetch", async () => {
    const reflector = { get: jest.fn().mockReturnValue({ entityType: "FeeStructure", model: "feeStructure" }) };
    const create = jest.fn().mockResolvedValue({});
    // The generic fetch would find a row here if it ran — proving the
    // override (a real null, i.e. "treat as CREATE-shaped") wins instead.
    const findUnique = jest.fn().mockResolvedValue({ id: "fs-1", name: "Old Name" });
    const prisma = { feeStructure: { findUnique }, auditLog: { create } };
    const interceptor = new AuditInterceptor(reflector as never, prisma as never);
    const context = buildContext({
      method: "PATCH",
      params: { id: "fs-1" },
      user: { id: "user-1" },
      routePath: "/fee-structures/:id",
      auditAction: "UPDATE",
      auditBefore: null,
    });

    await lastValueFrom(interceptor.intercept(context, buildHandler({ id: "fs-1", name: "New Name" })));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ before: undefined }) }));
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
