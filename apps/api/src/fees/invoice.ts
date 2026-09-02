import { Body, Controller, Get, Injectable, Param, Post, Query, UseGuards, ForbiddenException } from "@nestjs/common";
import { InvoiceStatus, Prisma, StudentStatus } from "@prisma/client";
import { computeOutstandingBalance } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory, type AppAbility } from "../casl/ability.factory";
import { Audited } from "../audit/audited.decorator";
import { GenerateInvoicesDto } from "./dto/generate-invoices.dto";

const INVOICE_DETAIL_INCLUDE = {
  lineItems: true,
  payments: true,
  student: { include: { user: true, guardians: true } },
  term: true,
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD FR7.2: one Invoice + its FEE-type InvoiceLineItems per ACTIVE
   * student in scope, skipping a student who already has an Invoice for
   * this term (the `@@unique([studentId, termId])` is the backstop) or has
   * zero applicable FeeStructure rows. Each student's create runs in its
   * own short transaction rather than one giant transaction wrapping the
   * whole batch — keeps this safely re-runnable (already-invoiced students
   * are skipped) if it's interrupted partway through a large school-wide
   * run, same "safe to re-run" precedent as setup-school.ts/seed-demo-data.ts,
   * and avoids Prisma's interactive-transaction timeout on a big batch.
   */
  async generate(dto: GenerateInvoicesDto) {
    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: dto.termId } });

    const students = await this.prisma.studentProfile.findMany({
      where: {
        status: StudentStatus.ACTIVE,
        currentClass: {
          academicSessionId: term.academicSessionId,
          ...(dto.classLevelId ? { classLevelId: dto.classLevelId } : {}),
        },
      },
      select: { id: true, currentClass: { select: { classLevelId: true } } },
    });

    // classLevels: zero rows = school-wide, one or more = scoped to those
    // class levels (FeeStructureClassLevel join, replacing the old single
    // nullable classLevelId column).
    const feeStructures = await this.prisma.feeStructure.findMany({
      where: { termId: dto.termId },
      include: { classLevels: true },
    });

    // One batch lookup instead of a findUnique per student (BUILD_PLAN.md
    // §8 item 5, N+1 audit) — a school-wide run is one extra query instead
    // of one per active student. Scoped to source=REGULAR so a student can
    // already have SUPPLEMENTARY invoices (from opting into an optional fee
    // after a term's regular run) without blocking their regular one.
    const alreadyInvoicedStudentIds = new Set(
      (
        await this.prisma.invoice.findMany({
          where: { termId: dto.termId, source: "REGULAR", studentId: { in: students.map((s) => s.id) } },
          select: { studentId: true },
        })
      ).map((invoice) => invoice.studentId),
    );

    // Batch un-invoiced FeeStructureStudentAssignment rows for this term's
    // optional (isMandatory=false) fee structures, keyed by studentId — same
    // batching precedent as alreadyInvoicedStudentIds, avoids an N+1.
    const optionalFeeStructureIds = feeStructures.filter((fs) => !fs.isMandatory).map((fs) => fs.id);
    const pendingAssignments = optionalFeeStructureIds.length
      ? await this.prisma.feeStructureStudentAssignment.findMany({
          where: { feeStructureId: { in: optionalFeeStructureIds }, invoiceId: null, studentId: { in: students.map((s) => s.id) } },
        })
      : [];
    const optedInFeeStructureIdsByStudent = new Map<string, Set<string>>();
    for (const assignment of pendingAssignments) {
      const set = optedInFeeStructureIdsByStudent.get(assignment.studentId) ?? new Set<string>();
      set.add(assignment.feeStructureId);
      optedInFeeStructureIdsByStudent.set(assignment.studentId, set);
    }

    let created = 0;
    let alreadyInvoiced = 0;
    let noApplicableFees = 0;

    for (const student of students) {
      if (alreadyInvoicedStudentIds.has(student.id)) {
        alreadyInvoiced++;
        continue;
      }

      const studentClassLevelId = student.currentClass?.classLevelId;
      const optedInFeeStructureIds = optedInFeeStructureIdsByStudent.get(student.id) ?? new Set<string>();
      // A mandatory fee structure always applies (once class-scoped); an
      // optional one applies only if the student has a matching un-invoiced
      // FeeStructureStudentAssignment (Bursar-recorded opt-in).
      const applicable = feeStructures.filter((fs) => {
        const classApplies = fs.classLevels.length === 0 || fs.classLevels.some((cl) => cl.classLevelId === studentClassLevelId);
        if (!classApplies) return false;
        return fs.isMandatory || optedInFeeStructureIds.has(fs.id);
      });
      if (applicable.length === 0) {
        noApplicableFees++;
        continue;
      }

      const totalAmount = applicable.reduce((sum, fs) => sum + Number(fs.amount), 0);
      const applicableOptionalIds = applicable.filter((fs) => !fs.isMandatory).map((fs) => fs.id);

      await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: { studentId: student.id, termId: dto.termId, totalAmount, dueDate: dto.dueDate },
        });
        await tx.invoiceLineItem.createMany({
          data: applicable.map((fs) => ({
            invoiceId: invoice.id,
            feeStructureId: fs.id,
            type: "FEE",
            amount: fs.amount,
            description: fs.name,
          })),
        });
        // Mark the opted-in assignments as billed so a later term-wide
        // generate run (or FeeStructureStudentAssignmentService) never bills
        // them a second time.
        if (applicableOptionalIds.length) {
          await tx.feeStructureStudentAssignment.updateMany({
            where: { studentId: student.id, feeStructureId: { in: applicableOptionalIds } },
            data: { invoiceId: invoice.id },
          });
        }
      });
      created++;
    }

    return { created, alreadyInvoiced, noApplicableFees };
  }

  /**
   * Legacy pre-launch debt migration (legacy-import.service.ts): one
   * Invoice + a single FEE-type InvoiceLineItem representing a student's
   * outstanding balance carried over from the school's previous system.
   * `feeStructureId` is deliberately null (same precedent as a DISCOUNT
   * line item, DiscountRequestService.approve) — there's no real
   * FeeStructure behind this charge.
   *
   * Must use `source: SUPPLEMENTARY`, never REGULAR: `invoices_regular_
   * per_student_term` enforces at most one REGULAR invoice per student per
   * term, and this same term still needs a normal `generate()` batch run
   * later without colliding with it.
   */
  async createLegacyOpeningBalance(input: { studentId: string; termId: string; amount: number; description?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          studentId: input.studentId,
          termId: input.termId,
          totalAmount: input.amount,
          dueDate: new Date(),
          source: "SUPPLEMENTARY",
        },
      });
      await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          feeStructureId: null,
          type: "FEE",
          amount: input.amount,
          description: input.description ?? "Opening balance – outstanding from previous term",
        },
      });
      return invoice;
    });
  }

  /**
   * Bursar/Super-Admin see every invoice (school-wide, filterable,
   * paginated); a parent sees only her own wards' invoices (empty array
   * with no ParentProfile); anyone else gets nothing — the controller's
   * `@CheckPolicies` on `read` already turns "nothing" into a 403 before
   * this is even called, since only those two grants exist for this Subject.
   */
  async findAllForUser(
    user: RequestUser,
    ability: AppAbility,
    filters: { studentId?: string; termId?: string; status?: InvoiceStatus; skip?: number; take?: number } = {},
  ) {
    const scopeWhere = await this.scopeWhereForUser(user, ability);
    if (scopeWhere === null) return filters.take !== undefined ? { data: [], total: 0 } : [];

    const where: Prisma.InvoiceWhereInput = {
      ...scopeWhere,
      studentId: filters.studentId,
      termId: filters.termId,
      status: filters.status,
    };

    if (filters.take === undefined) {
      const invoices = await this.prisma.invoice.findMany({
        where,
        include: INVOICE_DETAIL_INCLUDE,
        orderBy: { generatedAt: "desc" },
      });
      return invoices.map((invoice) => this.attachOutstandingBalance(invoice));
    }

    const [invoices, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        include: INVOICE_DETAIL_INCLUDE,
        orderBy: { generatedAt: "desc" },
        skip: filters.skip,
        take: filters.take,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { data: invoices.map((invoice) => this.attachOutstandingBalance(invoice)), total };
  }

  async findOneForUser(id: string, user: RequestUser, ability: AppAbility) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id }, include: INVOICE_DETAIL_INCLUDE });

    if (ability.can("manage", "Invoice")) return this.attachOutstandingBalance(invoice);

    if (user.roles.includes("PARENT")) {
      const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
      if (parentProfile && invoice.student.guardians.some((g) => g.parentId === parentProfile.id)) {
        return this.attachOutstandingBalance(invoice);
      }
    }

    throw new ForbiddenException("Insufficient permissions to view this invoice");
  }

  private async scopeWhereForUser(user: RequestUser, ability: AppAbility): Promise<Prisma.InvoiceWhereInput | null> {
    if (ability.can("manage", "Invoice")) return {};

    if (user.roles.includes("PARENT")) {
      const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
      if (!parentProfile) return null;
      return { student: { guardians: { some: { parentId: parentProfile.id } } } };
    }

    return null;
  }

  private attachOutstandingBalance<
    T extends {
      totalAmount: Prisma.Decimal;
      lineItems: { amount: Prisma.Decimal; type: string }[];
      payments: { amount: Prisma.Decimal; status: string }[];
    },
  >(invoice: T) {
    // Only DISCOUNT-type lines feed the formula — totalAmount is already the
    // sum of FEE-type lines at generation time (see the model comment), so
    // including them again here would double-count every fee.
    const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
    const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === "SUCCESSFUL").map((p) => Number(p.amount));
    const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
    return { ...invoice, outstandingBalance };
  }
}

@Controller("invoices")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class InvoiceController {
  constructor(
    private readonly service: InvoiceService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  // No model given — this is a bulk write (one Invoice + line items per
  // student in scope) whose response is a { created, alreadyInvoiced,
  // noApplicableFees } summary, not a single entity to snapshot.
  @Post("generate")
  @CheckPolicies((ability) => ability.can("manage", "Invoice"))
  @Audited("Invoice")
  generate(@Body() dto: GenerateInvoicesDto) {
    return this.service.generate(dto);
  }

  @Get()
  @CheckPolicies((ability) => ability.can("read", "Invoice"))
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("studentId") studentId?: string,
    @Query("termId") termId?: string,
    @Query("status") status?: InvoiceStatus,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.findAllForUser(user, ability, {
      studentId,
      termId,
      status,
      skip: skip === undefined ? undefined : Number(skip),
      take: take === undefined ? undefined : Number(take),
    });
  }

  @Get(":id")
  @CheckPolicies((ability) => ability.can("read", "Invoice"))
  findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.findOneForUser(id, user, ability);
  }
}
