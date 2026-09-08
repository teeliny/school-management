import { Controller, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

export interface AuditLogFilters {
  entityType?: string;
  action?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
  search?: string;
  skip?: number;
  take?: number;
}

/**
 * The one read path over AuditLog beyond DashboardService.auditHighlights'
 * small unfiltered "last N" widget (see that method's comment, now stale —
 * this is the real read endpoint it said didn't exist yet). Super-Admin-only,
 * via the "AuditLog" CASL Subject (ability.factory.ts) — nobody else gets
 * "manage all", so no other branch needs an explicit grant.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: AuditLogFilters) {
    const where: Prisma.AuditLogWhereInput = {
      entityType: filters.entityType,
      action: filters.action,
      actorUserId: filters.actorUserId,
      createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
      ...(filters.search
        ? {
            OR: [
              { entityId: { contains: filters.search, mode: "insensitive" } },
              { route: { contains: filters.search, mode: "insensitive" } },
              { actor: { firstName: { contains: filters.search, mode: "insensitive" } } },
              { actor: { lastName: { contains: filters.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const take = Math.min(filters.take ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: filters.skip ?? 0,
        take,
        include: { actor: { select: { firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : null,
        actorEmail: row.actor?.email ?? null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        route: row.route,
        before: row.before,
        after: row.after,
      })),
      total,
    };
  }

  /** Distinct entityType/action values seen so far — powers the filter dropdowns without a hand-maintained list that drifts from what @Audited actually covers. */
  async filterOptions() {
    const [entityTypes, actions] = await Promise.all([
      this.prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
      this.prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    ]);
    return {
      entityTypes: entityTypes.map((r) => r.entityType),
      actions: actions.map((r) => r.action),
    };
  }
}

@Controller("audit-log")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  @CheckPolicies((ability) => ability.can("read", "AuditLog"))
  list(
    @Query("entityType") entityType?: string,
    @Query("action") action?: string,
    @Query("actorUserId") actorUserId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("search") search?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.service.list({
      entityType,
      action,
      actorUserId,
      from: from ? new Date(from) : undefined,
      // Inclusive of the whole day — `to` arrives as a bare date (e.g. from
      // a date input), which would otherwise mean midnight and exclude
      // everything logged that day.
      to: to ? new Date(new Date(to).setUTCHours(23, 59, 59, 999)) : undefined,
      search,
      skip: skip === undefined ? undefined : Number(skip),
      take: take === undefined ? undefined : Number(take),
    });
  }

  @Get("filter-options")
  @CheckPolicies((ability) => ability.can("read", "AuditLog"))
  filterOptions() {
    return this.service.filterOptions();
  }
}
