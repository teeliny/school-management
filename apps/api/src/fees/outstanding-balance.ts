import { Body, Controller, Get, Injectable, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ClassLevelCategory, Prisma, StudentStatus } from "@prisma/client";
import { computeOutstandingBalance, groupToCategories, type ClassLevelCategoryGroup } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { resolvePrincipalHeadteacherCategories } from "../common/class-level-category-scope";
import { SetDebtExcusalDto } from "./dto/set-debt-excusal.dto";

export interface OutstandingBalanceRow {
  studentId: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  classArmName: string | null;
  classLevelName: string | null;
  totalOutstanding: number;
  isDebtExcused: boolean;
  debtExcusedAt: Date | null;
  debtExcusedReason: string | null;
}

@Injectable()
export class OutstandingBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate "who is overdue" view, one row per student rather than per
   * invoice (contrast InvoiceService.findAllForUser) — scoped to invoices
   * already past their due date, not merely unpaid (see the `status:
   * OVERDUE` filter below). Whether this method may be called at all is
   * already gated by CASL's OutstandingBalanceSummary Subject (read:
   * Super-Admin/Admin/Bursar/Principal/VP/Headteacher); the only extra thing
   * done here is narrowing a Principal/VP/Headteacher to their own section —
   * same resolvePrincipalHeadteacherCategories convention
   * StudentService.findAllForUser already uses for row scoping.
   */
  async findForUser(
    user: RequestUser,
    filters: {
      termId?: string;
      classLevelId?: string;
      classLevelCategoryGroup?: ClassLevelCategoryGroup;
      search?: string;
      isExcused?: boolean;
      skip?: number;
      take?: number;
    } = {},
  ): Promise<{ data: OutstandingBalanceRow[]; total: number }> {
    const restrictedCategories = resolvePrincipalHeadteacherCategories(user);

    const categoryIn = new Set<ClassLevelCategory>(
      filters.classLevelCategoryGroup ? groupToCategories(filters.classLevelCategoryGroup) : [],
    );
    if (restrictedCategories) {
      if (categoryIn.size === 0) {
        for (const category of restrictedCategories) categoryIn.add(category);
      } else {
        // A Principal/Headteacher-supplied section filter narrows within
        // their own restriction, never widens past it.
        for (const category of [...categoryIn]) {
          if (!restrictedCategories.includes(category)) categoryIn.delete(category);
        }
      }
    }

    const classWhere: Prisma.ClassArmWhereInput = {};
    if (filters.classLevelId) classWhere.classLevelId = filters.classLevelId;
    if (categoryIn.size > 0) classWhere.classLevel = { category: { in: [...categoryIn] } };

    const studentWhere: Prisma.StudentProfileWhereInput = {
      status: StudentStatus.ACTIVE,
      ...(filters.isExcused !== undefined ? { isDebtExcused: filters.isExcused } : {}),
      ...(Object.keys(classWhere).length > 0 ? { currentClass: classWhere } : {}),
      ...(filters.search
        ? {
            OR: [
              { admissionNumber: { contains: filters.search, mode: "insensitive" as const } },
              { user: { firstName: { contains: filters.search, mode: "insensitive" as const } } },
              { user: { lastName: { contains: filters.search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };

    const students = await this.prisma.studentProfile.findMany({
      where: studentWhere,
      include: {
        user: true,
        currentClass: { include: { classLevel: true } },
        // "Outstanding" here means overdue, not merely unpaid — an invoice
        // not yet past its due date doesn't belong on this view even if it
        // has a balance. `status: OVERDUE` is a stored, indexed column
        // (@@index([status])) recomputed alongside outstandingBalance on
        // every Payment/DiscountRequest write (computeInvoiceStatus,
        // "now > dueDate"), so this reuses that instead of re-deriving the
        // date comparison here.
        invoices: {
          where: { status: "OVERDUE", ...(filters.termId ? { termId: filters.termId } : {}) },
          include: { lineItems: true, payments: true },
        },
      },
    });

    const rows = students
      .map((student) => {
        const totalOutstanding = student.invoices.reduce((sum, invoice) => {
          const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
          const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === "SUCCESSFUL").map((p) => Number(p.amount));
          return sum + computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
        }, 0);
        return {
          studentId: student.id,
          admissionNumber: student.admissionNumber,
          firstName: student.user.firstName,
          lastName: student.user.lastName,
          classArmName: student.currentClass ? `${student.currentClass.classLevel.name} ${student.currentClass.name}` : null,
          classLevelName: student.currentClass?.classLevel.name ?? null,
          totalOutstanding,
          isDebtExcused: student.isDebtExcused,
          debtExcusedAt: student.debtExcusedAt,
          debtExcusedReason: student.debtExcusedReason,
        };
      })
      .filter((row) => row.totalOutstanding > 0)
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    // Pagination happens after the aggregate/filter/sort above, in memory —
    // unlike a plain Prisma list this "who's overdue" view is a computed
    // rollup (sum per student across their overdue invoices), so LIMIT/
    // OFFSET at the query level can't express it; single-school row counts
    // keep this cheap, same tradeoff DashboardService's aggregations already
    // make. `skip`/`take` are both-or-neither from the controller, so
    // `take === undefined` is the one signal needed to skip slicing.
    const total = rows.length;
    const data = filters.take === undefined ? rows : rows.slice(filters.skip ?? 0, (filters.skip ?? 0) + filters.take);
    return { data, total };
  }

  /**
   * Purely informational and freely reversible (product ask: flag a student
   * so Principal/Headteacher know they're permitted to stay in class for
   * now) — never affects totalOutstanding above. Un-excusing clears the
   * actor/reason/timestamp back to null so nothing stale lingers into the
   * next excusal.
   */
  async setExcusal(studentId: string, dto: SetDebtExcusalDto, actorUserId: string) {
    return this.prisma.studentProfile.update({
      where: { id: studentId },
      data: dto.isExcused
        ? { isDebtExcused: true, debtExcusedAt: new Date(), debtExcusedByUserId: actorUserId, debtExcusedReason: dto.reason ?? null }
        : { isDebtExcused: false, debtExcusedAt: null, debtExcusedByUserId: null, debtExcusedReason: null },
    });
  }
}

@Controller("outstanding-balances")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class OutstandingBalanceController {
  constructor(private readonly service: OutstandingBalanceService) {}

  @Get()
  @CheckPolicies((ability) => ability.can("read", "OutstandingBalanceSummary"))
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("termId") termId?: string,
    @Query("classLevelId") classLevelId?: string,
    @Query("classLevelCategoryGroup") classLevelCategoryGroup?: ClassLevelCategoryGroup,
    @Query("search") search?: string,
    @Query("isExcused") isExcused?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.service.findForUser(user, {
      termId,
      classLevelId,
      classLevelCategoryGroup,
      search,
      isExcused: isExcused === undefined ? undefined : isExcused === "true",
      skip: skip === undefined ? undefined : Number(skip),
      take: take === undefined ? undefined : Number(take),
    });
  }

  // No CASL bare role check needed — Bursar/Super-Admin are exactly who
  // "manage OutstandingBalanceSummary" resolves true for (Admin/Principal/
  // VP/Headteacher only ever get "read"), so unlike DiscountRequest's
  // approve/reject this needs no manual role-check carve-out.
  //
  // Route param is `:id`, not `:studentId` — AuditInterceptor's before-fetch
  // only ever reads `request.params.id` (audit.interceptor.ts), so this name
  // is what makes the "before" snapshot on this @Audited route actually work.
  @Patch(":id/excuse")
  @CheckPolicies((ability) => ability.can("manage", "OutstandingBalanceSummary"))
  @Audited("StudentProfile", "studentProfile")
  setExcusal(@Param("id") studentId: string, @Body() dto: SetDebtExcusalDto, @CurrentUser() user: RequestUser) {
    return this.service.setExcusal(studentId, dto, user.id);
  }
}
