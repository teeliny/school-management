import { Body, Controller, ForbiddenException, Get, Injectable, Param, Post, Query, UseGuards } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { computeInvoiceStatus, computeOutstandingBalance, QUEUE_NAMES, type ReceiptGenerationJob } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory, type AppAbility } from "../casl/ability.factory";
import { RecordCashPaymentDto } from "./dto/record-cash-payment.dto";

const PAYMENT_DETAIL_INCLUDE = {
  receipt: true,
  invoice: { include: { student: { include: { user: true, guardians: true } } } },
} satisfies Prisma.PaymentInclude;

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.RECEIPT_GENERATION) private readonly receiptQueue: Queue<ReceiptGenerationJob>,
  ) {}

  /**
   * PRD §3.9: "CASH is recorded by the Bursar and takes effect immediately
   * (SUCCESSFUL) — the Bursar witnessed the payment directly." No
   * assignment-type scoping is needed here (unlike Attendance's per-student-
   * scoped writes) — CASL already fully gates who can reach this endpoint
   * (Bursar/Super-Admin, domain-wide), so `recordedByStaffId` just resolves
   * to the caller's own StaffProfile if they have one, `null` otherwise
   * (Super-Admin override, same as ScoreEntry.enteredByStaffId).
   */
  async recordCash(dto: RecordCashPaymentDto, user: RequestUser) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: dto.invoiceId },
      include: { lineItems: true, payments: true },
    });

    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });
    const paidAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: dto.amount,
          method: PaymentMethod.CASH,
          status: PaymentStatus.SUCCESSFUL,
          paidAt,
          recordedByStaffId: staffProfile?.id ?? null,
        },
      });

      // Only DISCOUNT-type lines feed the formula — totalAmount already
      // includes every FEE-type line at generation time (see the Invoice
      // model comment), so summing them again here would double-count.
      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = [
        ...invoice.payments.filter((p) => p.status === PaymentStatus.SUCCESSFUL).map((p) => Number(p.amount)),
        dto.amount,
      ];
      const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
      const paidTotal = successfulPaymentAmounts.reduce((sum, amount) => sum + amount, 0);
      const status = computeInvoiceStatus(outstandingBalance, paidTotal, invoice.dueDate, paidAt);

      await tx.invoice.update({ where: { id: invoice.id }, data: { status } });

      const receipt = await tx.receipt.create({
        data: {
          paymentId: payment.id,
          receiptNumber: `RCT-${payment.id.slice(0, 8).toUpperCase()}`,
          issuedAt: paidAt,
        },
      });

      return { payment, receipt, invoiceStatus: status, outstandingBalance };
    });

    await this.receiptQueue.add("generate", { receiptId: result.receipt.id });

    return result;
  }

  async findAllForUser(
    user: RequestUser,
    ability: AppAbility,
    filters: { invoiceId?: string; studentId?: string; skip?: number; take?: number } = {},
  ) {
    const scopeWhere = await this.scopeWhereForUser(user, ability);
    if (scopeWhere === null) return filters.take !== undefined ? { data: [], total: 0 } : [];

    // Combined via AND, not spread — scopeWhere and the studentId filter
    // both key on `invoice`, and a spread would let whichever is listed
    // last silently clobber the other (this is exactly what happened here
    // until a parent-scoping test caught it: an unfiltered `invoice:
    // undefined` overwrote the parent's guardian-scoped `invoice` clause).
    const where: Prisma.PaymentWhereInput = {
      AND: [
        scopeWhere,
        filters.invoiceId ? { invoiceId: filters.invoiceId } : {},
        filters.studentId ? { invoice: { studentId: filters.studentId } } : {},
      ],
    };

    if (filters.take === undefined) {
      return this.prisma.payment.findMany({ where, include: PAYMENT_DETAIL_INCLUDE, orderBy: { createdAt: "desc" } });
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_DETAIL_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: filters.skip,
        take: filters.take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { data, total };
  }

  async findOneForUser(id: string, user: RequestUser, ability: AppAbility) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id }, include: PAYMENT_DETAIL_INCLUDE });

    if (ability.can("manage", "Payment")) return payment;

    if (user.roles.includes("PARENT")) {
      const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
      if (parentProfile && payment.invoice.student.guardians.some((g) => g.parentId === parentProfile.id)) {
        return payment;
      }
    }

    throw new ForbiddenException("Insufficient permissions to view this payment");
  }

  private async scopeWhereForUser(user: RequestUser, ability: AppAbility): Promise<Prisma.PaymentWhereInput | null> {
    if (ability.can("manage", "Payment")) return {};

    if (user.roles.includes("PARENT")) {
      const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
      if (!parentProfile) return null;
      return { invoice: { student: { guardians: { some: { parentId: parentProfile.id } } } } };
    }

    return null;
  }
}

@Controller("payments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class PaymentController {
  constructor(
    private readonly service: PaymentService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post("cash")
  @CheckPolicies((ability) => ability.can("manage", "Payment"))
  recordCash(@Body() dto: RecordCashPaymentDto, @CurrentUser() user: RequestUser) {
    return this.service.recordCash(dto, user);
  }

  @Get()
  @CheckPolicies((ability) => ability.can("read", "Payment"))
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("invoiceId") invoiceId?: string,
    @Query("studentId") studentId?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.findAllForUser(user, ability, {
      invoiceId,
      studentId,
      skip: skip === undefined ? undefined : Number(skip),
      take: take === undefined ? undefined : Number(take),
    });
  }

  @Get(":id")
  @CheckPolicies((ability) => ability.can("read", "Payment"))
  findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.findOneForUser(id, user, ability);
  }
}
