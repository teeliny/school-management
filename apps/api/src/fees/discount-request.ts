import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { DiscountRequestStatus, DiscountRequestType, Prisma } from "@prisma/client";
import { computeInvoiceStatus, computeOutstandingBalance } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory, type AppAbility } from "../casl/ability.factory";
import { Audited } from "../audit/audited.decorator";
import { RaiseDiscountRequestDto } from "./dto/raise-discount-request.dto";
import { RejectDiscountRequestDto } from "./dto/reject-discount-request.dto";

const DISCOUNT_REQUEST_DETAIL_INCLUDE = {
  invoice: { include: { student: { include: { user: true } } } },
} satisfies Prisma.DiscountRequestInclude;

@Injectable()
export class DiscountRequestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD FR7.8: Bursar raises against a specific Invoice (Super-Admin can
   * also raise, via the same "manage DiscountRequest" grant — same override
   * shape as CASH/manual-transfer). Same outstanding-balance guard as
   * submitManualBankTransfer (no point discounting an already-settled
   * invoice); requestedByStaffId resolves the same way recordedByStaffId
   * does elsewhere in this domain.
   */
  async raise(dto: RaiseDiscountRequestDto, user: RequestUser) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: dto.invoiceId },
      include: { lineItems: true, payments: true },
    });

    const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
    const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === "SUCCESSFUL").map((p) => Number(p.amount));
    const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
    if (outstandingBalance <= 0) {
      throw new BadRequestException("This invoice has no outstanding balance");
    }

    if (dto.type === DiscountRequestType.PERCENTAGE && dto.value > 100) {
      throw new BadRequestException("A percentage discount value cannot exceed 100");
    }

    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });

    return this.prisma.discountRequest.create({
      data: {
        invoiceId: invoice.id,
        requestedByStaffId: staffProfile?.id ?? null,
        type: dto.type,
        value: dto.value,
        reason: dto.reason,
        status: DiscountRequestStatus.PENDING,
      },
      include: DISCOUNT_REQUEST_DETAIL_INCLUDE,
    });
  }

  /**
   * PRD FR7.8: Super-Admin only (enforced in the controller). Applies the
   * discount as a negative DISCOUNT InvoiceLineItem, computed against the
   * invoice's live totalAmount, then recomputes the invoice's balance/status
   * in the same transaction — same shape as
   * PaymentController.approveManualBankTransfer, minus the Receipt/queue
   * steps (a discount produces no Payment).
   */
  async approve(id: string, reviewerUserId: string) {
    const discountRequest = await this.prisma.discountRequest.findUniqueOrThrow({
      where: { id },
      include: { invoice: { include: { lineItems: true, payments: true } } },
    });
    if (discountRequest.status !== DiscountRequestStatus.PENDING) {
      throw new BadRequestException("Only a PENDING discount request can be approved");
    }

    const invoice = discountRequest.invoice;
    const reviewedAt = new Date();

    const rawAmount =
      discountRequest.type === DiscountRequestType.PERCENTAGE
        ? (Number(discountRequest.value) / 100) * Number(invoice.totalAmount)
        : Number(discountRequest.value);
    const discountLineAmount = -Math.round(rawAmount * 100) / 100;
    const description = `${
      discountRequest.type === DiscountRequestType.PERCENTAGE ? `${Number(discountRequest.value)}% discount` : "Fixed discount"
    } — ${discountRequest.reason}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedDiscountRequest = await tx.discountRequest.update({
        where: { id },
        data: { status: DiscountRequestStatus.APPROVED, reviewedByUserId: reviewerUserId, reviewedAt },
      });

      await tx.invoiceLineItem.create({
        data: { invoiceId: invoice.id, type: "DISCOUNT", amount: discountLineAmount, description },
      });

      const discountAmounts = [...invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount)), discountLineAmount];
      const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === "SUCCESSFUL").map((p) => Number(p.amount));
      const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
      const paidTotal = successfulPaymentAmounts.reduce((sum, amount) => sum + amount, 0);
      const status = computeInvoiceStatus(outstandingBalance, paidTotal, invoice.dueDate, reviewedAt);

      await tx.invoice.update({ where: { id: invoice.id }, data: { status } });

      return { discountRequest: updatedDiscountRequest, invoiceStatus: status, outstandingBalance };
    });

    return result;
  }

  /** PRD FR7.8: Super-Admin only (enforced in the controller). No invoice/line-item change — a rejected request never counted toward the balance. */
  async reject(id: string, reviewerUserId: string, rejectionReason: string) {
    const discountRequest = await this.prisma.discountRequest.findUniqueOrThrow({ where: { id } });
    if (discountRequest.status !== DiscountRequestStatus.PENDING) {
      throw new BadRequestException("Only a PENDING discount request can be rejected");
    }

    return this.prisma.discountRequest.update({
      where: { id },
      data: { status: DiscountRequestStatus.REJECTED, reviewedByUserId: reviewerUserId, reviewedAt: new Date(), rejectionReason },
    });
  }

  async findAllForUser(
    user: RequestUser,
    ability: AppAbility,
    filters: { invoiceId?: string; studentId?: string; status?: DiscountRequestStatus; skip?: number; take?: number } = {},
  ) {
    if (!ability.can("manage", "DiscountRequest")) {
      return filters.take !== undefined ? { data: [], total: 0 } : [];
    }

    const where: Prisma.DiscountRequestWhereInput = {
      AND: [
        filters.invoiceId ? { invoiceId: filters.invoiceId } : {},
        filters.studentId ? { invoice: { studentId: filters.studentId } } : {},
        filters.status ? { status: filters.status } : {},
      ],
    };

    if (filters.take === undefined) {
      return this.prisma.discountRequest.findMany({ where, include: DISCOUNT_REQUEST_DETAIL_INCLUDE, orderBy: { createdAt: "desc" } });
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.discountRequest.findMany({
        where,
        include: DISCOUNT_REQUEST_DETAIL_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: filters.skip,
        take: filters.take,
      }),
      this.prisma.discountRequest.count({ where }),
    ]);
    return { data, total };
  }

  async findOneForUser(id: string, ability: AppAbility) {
    if (!ability.can("manage", "DiscountRequest")) {
      throw new ForbiddenException("Insufficient permissions to view this discount request");
    }
    return this.prisma.discountRequest.findUniqueOrThrow({ where: { id }, include: DISCOUNT_REQUEST_DETAIL_INCLUDE });
  }
}

@Controller("discount-requests")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class DiscountRequestController {
  constructor(
    private readonly service: DiscountRequestService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "DiscountRequest"))
  @Audited("DiscountRequest", "discountRequest")
  raise(@Body() dto: RaiseDiscountRequestDto, @CurrentUser() user: RequestUser) {
    return this.service.raise(dto, user);
  }

  /** Super-Admin-only carve-out — same manual role-check pattern as PaymentController.approveManualBankTransfer (Bursar's own "manage DiscountRequest" grant would otherwise satisfy any CASL check on this same subject). */
  @Patch(":id/approve")
  @Audited("DiscountRequest", "discountRequest")
  approve(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only the Super-Admin can approve a discount request");
    }
    return this.service.approve(id, user.id);
  }

  /** Super-Admin-only carve-out — see approve()'s comment. */
  @Patch(":id/reject")
  @Audited("DiscountRequest", "discountRequest")
  reject(@Param("id") id: string, @Body() dto: RejectDiscountRequestDto, @CurrentUser() user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only the Super-Admin can reject a discount request");
    }
    return this.service.reject(id, user.id, dto.rejectionReason);
  }

  @Get()
  @CheckPolicies((ability) => ability.can("read", "DiscountRequest"))
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("invoiceId") invoiceId?: string,
    @Query("studentId") studentId?: string,
    @Query("status") status?: DiscountRequestStatus,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.findAllForUser(user, ability, {
      invoiceId,
      studentId,
      status,
      skip: skip === undefined ? undefined : Number(skip),
      take: take === undefined ? undefined : Number(take),
    });
  }

  @Get(":id")
  @CheckPolicies((ability) => ability.can("read", "DiscountRequest"))
  findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.findOneForUser(id, ability);
  }
}
