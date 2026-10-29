import { Body, Controller, Get, Injectable, Param, Patch, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { ClassLevelCategory, Prisma, StudentStatus } from "@prisma/client";
import { computeOutstandingBalance, formatPersonName, groupToCategories, type ClassLevelCategoryGroup } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { resolvePrincipalHeadteacherCategories } from "../common/class-level-category-scope";
import { SetDebtExcusalDto } from "./dto/set-debt-excusal.dto";
import { renderOutstandingBalancesPdf, type OutstandingBalancePdfRow } from "./outstanding-balance-pdf.util";

interface OutstandingBalanceFilters {
  termId?: string;
  classLevelId?: string;
  classLevelCategoryGroup?: ClassLevelCategoryGroup;
  search?: string;
  isExcused?: boolean;
}

// Prisma's generated enum object keeps schema declaration order (CRECHE,
// RECEPTION, NURSERY, PRIMARY, JSS, SSS) — the school's own progression.
const CATEGORY_RANK = new Map(Object.values(ClassLevelCategory).map((category, index) => [category, index]));

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
    filters: OutstandingBalanceFilters & { skip?: number; take?: number } = {},
  ): Promise<{ data: OutstandingBalanceRow[]; total: number }> {
    const students = await this.findOverdueStudents(user, filters);
    const rows = students.map(({ row }) => row).sort((a, b) => b.totalOutstanding - a.totalOutstanding);

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
   * Printable version of findForUser's list (same filters and section
   * scoping, unpaginated), ordered for a paper roll-call rather than by
   * amount: class level first (category progression, then ClassLevel.order,
   * then level name — a no-op when a single class level is filtered), then
   * last name, then first name. Parent phone is the primary-contact guardian's, falling back
   * to any other guardian with one on file.
   */
  async buildExportPdf(user: RequestUser, filters: OutstandingBalanceFilters): Promise<Buffer> {
    const students = await this.findOverdueStudents(user, filters);
    students.sort((a, b) => {
      const levelA = a.student.currentClass?.classLevel;
      const levelB = b.student.currentClass?.classLevel;
      // Students with no current class sort after every class level.
      const rankA = levelA ? [CATEGORY_RANK.get(levelA.category)!, levelA.order] : [Infinity, Infinity];
      const rankB = levelB ? [CATEGORY_RANK.get(levelB.category)!, levelB.order] : [Infinity, Infinity];
      return (
        rankA[0]! - rankB[0]! ||
        rankA[1]! - rankB[1]! ||
        // ClassLevel.order is in practice set per category (Basic 1–6 all
        // share one value), so the level name — numeric-aware, so "Basic 10"
        // follows "Basic 2" — is what separates levels within a category.
        (levelA && levelB ? levelA.name.localeCompare(levelB.name, "en", { numeric: true, sensitivity: "base" }) : 0) ||
        a.row.lastName.localeCompare(b.row.lastName, "en", { sensitivity: "base" }) ||
        a.row.firstName.localeCompare(b.row.firstName, "en", { sensitivity: "base" })
      );
    });

    const pdfRows: OutstandingBalancePdfRow[] = students.map(({ student, row }) => {
      const guardians = [...student.guardians].sort((a, b) => Number(b.isPrimaryContact) - Number(a.isPrimaryContact));
      return {
        studentName: formatPersonName(row),
        admissionNumber: row.admissionNumber,
        className: row.classArmName,
        amount: row.totalOutstanding,
        parentPhone: guardians.find((guardian) => guardian.parent.user.phone)?.parent.user.phone ?? null,
      };
    });

    const [school, term, classLevel] = await Promise.all([
      this.prisma.schoolProfile.findFirstOrThrow(),
      filters.termId ? this.prisma.term.findUnique({ where: { id: filters.termId }, include: { academicSession: true } }) : null,
      filters.classLevelId ? this.prisma.classLevel.findUnique({ where: { id: filters.classLevelId } }) : null,
    ]);
    const subtitle = [
      term ? `${term.academicSession.name} ${term.name}` : "All terms",
      classLevel?.name ?? "All class levels",
      `Generated ${new Date().toDateString()}`,
    ].join("   ·   ");

    return renderOutstandingBalancesPdf(
      pdfRows,
      { name: school.name, address: school.address, contactEmail: school.contactEmail, contactPhone: school.contactPhone },
      subtitle,
    );
  }

  /**
   * Shared by the paginated list and the PDF export: every in-scope student
   * with a non-zero overdue total, unsorted (guardians are joined for the
   * export's phone column).
   */
  private async findOverdueStudents(user: RequestUser, filters: OutstandingBalanceFilters) {
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
          where: { status: "OVERDUE", voidedAt: null, ...(filters.termId ? { termId: filters.termId } : {}) },
          include: { lineItems: true, payments: true },
        },
        guardians: { include: { parent: { include: { user: true } } } },
      },
    });

    return students
      .map((student) => {
        const totalOutstanding = student.invoices.reduce((sum, invoice) => {
          const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
          const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === "SUCCESSFUL").map((p) => Number(p.amount));
          return sum + computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
        }, 0);
        const row: OutstandingBalanceRow = {
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
        return { student, row };
      })
      .filter(({ row }) => row.totalOutstanding > 0);
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

  @Get("export.pdf")
  @CheckPolicies((ability) => ability.can("read", "OutstandingBalanceSummary"))
  async exportPdf(
    @CurrentUser() user: RequestUser,
    @Query("termId") termId?: string,
    @Query("classLevelId") classLevelId?: string,
    @Query("classLevelCategoryGroup") classLevelCategoryGroup?: ClassLevelCategoryGroup,
    @Query("search") search?: string,
    @Query("isExcused") isExcused?: string,
  ) {
    const buffer = await this.service.buildExportPdf(user, {
      termId,
      classLevelId,
      classLevelCategoryGroup,
      search,
      isExcused: isExcused === undefined ? undefined : isExcused === "true",
    });
    return new StreamableFile(buffer, { type: "application/pdf", disposition: 'attachment; filename="outstanding-balances.pdf"' });
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
