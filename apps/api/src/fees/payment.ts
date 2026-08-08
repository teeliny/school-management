import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { memoryStorage } from "multer";
import { PaymentGatewayProvider, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { computeInvoiceStatus, computeOutstandingBalance, QUEUE_NAMES, type ReceiptGenerationJob } from "@school/types";
import {
  mapChannelToPaymentMethod,
  type GatewayTransactionResult,
  type PaymentGatewayAdapter,
} from "@school/types/payment-gateways";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory, type AppAbility } from "../casl/ability.factory";
import { RecordCashPaymentDto } from "./dto/record-cash-payment.dto";
import { InitiateGatewayCheckoutDto } from "./dto/initiate-gateway-checkout.dto";
import { SubmitManualBankTransferDto } from "./dto/submit-manual-bank-transfer.dto";
import { RejectPaymentDto } from "./dto/reject-payment.dto";
import { PaymentGatewayCredentialsService } from "./gateway/payment-gateway-credentials";
import { PAYMENT_GATEWAY_ADAPTER } from "./gateway/payment-gateway.tokens";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter";

const PAYMENT_DETAIL_INCLUDE = {
  receipt: true,
  invoice: { include: { student: { include: { user: true, guardians: true } } } },
} satisfies Prisma.PaymentInclude;

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_PROOF_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROOF_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly credentials: PaymentGatewayCredentialsService,
    @InjectQueue(QUEUE_NAMES.RECEIPT_GENERATION) private readonly receiptQueue: Queue<ReceiptGenerationJob>,
    @Inject(PAYMENT_GATEWAY_ADAPTER) private readonly gatewayAdapter: PaymentGatewayAdapter,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
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

  private activeProvider(): PaymentGatewayProvider {
    return (this.config.get<string>("PAYMENT_GATEWAY_PROVIDER") ?? "MONNIFY") as PaymentGatewayProvider;
  }

  /**
   * PRD FR7.3: checkout is parent-initiated. Reuses the exact same
   * guardian-scoping check InvoiceService.findOneForUser has (Bursar/Super-
   * Admin unconditioned via `manage`, else verify the caller guardians this
   * invoice's student) — no new CASL rule needed since the controller
   * already gates on the existing `read` grant for Invoice.
   */
  async initiateGatewayCheckout(dto: InitiateGatewayCheckoutDto, user: RequestUser, ability: AppAbility): Promise<{ checkoutUrl: string }> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: dto.invoiceId },
      include: { lineItems: true, payments: true, student: { include: { guardians: true } } },
    });

    if (!ability.can("manage", "Invoice")) {
      const parentProfile = user.roles.includes("PARENT")
        ? await this.prisma.parentProfile.findUnique({ where: { userId: user.id } })
        : null;
      const isGuardian = parentProfile && invoice.student.guardians.some((g) => g.parentId === parentProfile.id);
      if (!isGuardian) {
        throw new ForbiddenException("Insufficient permissions to pay this invoice");
      }
    }

    const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
    const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === PaymentStatus.SUCCESSFUL).map((p) => Number(p.amount));
    const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
    if (outstandingBalance <= 0) {
      throw new BadRequestException("This invoice has no outstanding balance");
    }

    // Generated once per invoice, reused across retries (PRD §3.9's literal
    // "unique per invoice" wording, not per-attempt) — re-clicking "pay"
    // after an abandoned/expired checkout link reuses the same reference
    // rather than minting a new one each time.
    const reference = invoice.gatewayPaymentReference ?? `INV-${invoice.id}-${Date.now()}`;
    if (!invoice.gatewayPaymentReference) {
      await this.prisma.invoice.update({ where: { id: invoice.id }, data: { gatewayPaymentReference: reference } });
    }

    const provider = this.activeProvider();
    const existingPending = invoice.payments.find((p) => p.status === PaymentStatus.PENDING && p.gatewayProvider === provider);
    if (!existingPending) {
      await this.prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: outstandingBalance,
          method: PaymentMethod.GATEWAY_CARD,
          status: PaymentStatus.PENDING,
          gatewayProvider: provider,
          paidByUserId: user.id,
        },
      });
    }

    const payer = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const credentials = await this.credentials.getCredentials(provider);
    return this.gatewayAdapter.initTransaction(credentials, {
      amount: outstandingBalance,
      reference,
      customerEmail: payer.email,
      customerName: `${payer.firstName} ${payer.lastName}`,
      description: "School fees payment",
      redirectUrl: `${this.config.get<string>("WEB_BASE_URL")}/payments/complete`,
    });
  }

  /**
   * Shared success/failure resolution — called from both the webhook
   * handler (this file) and, duplicated (apps/worker can't import this
   * service — same cross-process boundary BroadsheetService's
   * reimplementation of computeAnnualSummary already established), the
   * reconciliation processor. Idempotent: a Payment already SUCCESSFUL with
   * this exact gatewayTransactionReference means a retried/duplicated
   * webhook or poll, and is a no-op (PRD FR7.5).
   */
  async resolveGatewayOutcome(
    invoiceId: string,
    provider: PaymentGatewayProvider,
    result: GatewayTransactionResult,
  ): Promise<{ handled: boolean }> {
    if (result.status === "SUCCESSFUL") {
      const alreadyProcessed = await this.prisma.payment.findFirst({
        where: { gatewayTransactionReference: result.gatewayTransactionReference, status: PaymentStatus.SUCCESSFUL },
      });
      if (alreadyProcessed) return { handled: true };
    }

    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lineItems: true, payments: true },
    });

    let payment = invoice.payments.find((p) => p.status === PaymentStatus.PENDING && p.gatewayProvider === provider) ?? null;
    if (!payment) {
      // Defensive: resolving a checkout this deployment doesn't have a
      // PENDING row for (e.g. state lost, or a very old/replayed
      // reference) — create it now so the same resolution logic below
      // still applies uniformly rather than branching around a missing row.
      payment = await this.prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: result.amountPaid,
          method: PaymentMethod.GATEWAY_CARD,
          status: PaymentStatus.PENDING,
          gatewayProvider: provider,
        },
      });
    }

    if (result.status === "PENDING") return { handled: true };

    if (result.status === "FAILED") {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, gatewayTransactionReference: result.gatewayTransactionReference },
      });
      return { handled: true };
    }

    const method = mapChannelToPaymentMethod(result.channel);
    const paidAt = result.paidAt ?? new Date();
    const resolvedPaymentId = payment.id;

    const txResult = await this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: resolvedPaymentId },
        data: { status: PaymentStatus.SUCCESSFUL, gatewayTransactionReference: result.gatewayTransactionReference, paidAt, method },
      });

      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = [
        ...invoice.payments
          .filter((p) => p.status === PaymentStatus.SUCCESSFUL && p.id !== resolvedPaymentId)
          .map((p) => Number(p.amount)),
        result.amountPaid,
      ];
      const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
      const paidTotal = successfulPaymentAmounts.reduce((sum, amount) => sum + amount, 0);
      const status = computeInvoiceStatus(outstandingBalance, paidTotal, invoice.dueDate, paidAt);

      await tx.invoice.update({ where: { id: invoice.id }, data: { status } });

      const receipt = await tx.receipt.create({
        data: {
          paymentId: updatedPayment.id,
          receiptNumber: `RCT-${updatedPayment.id.slice(0, 8).toUpperCase()}`,
          issuedAt: paidAt,
        },
      });

      return { receipt };
    });

    await this.receiptQueue.add("generate", { receiptId: txResult.receipt.id });

    return { handled: true };
  }

  /**
   * PRD FR7.3a/ARCHITECTURE §10.2: a parent paid directly into the school's
   * bank account outside the platform and sent proof to the Bursar — there's
   * no gateway transaction to trust, so this starts PENDING_APPROVAL and
   * deliberately does NOT touch the invoice's balance/status until a
   * Super-Admin reviews it (approveManualBankTransfer/rejectManualBankTransfer
   * below). Same `recordedByStaffId` resolution as recordCash.
   */
  async submitManualBankTransfer(dto: SubmitManualBankTransferDto, file: Express.Multer.File, user: RequestUser) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: dto.invoiceId },
      include: { lineItems: true, payments: true },
    });

    const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
    const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === PaymentStatus.SUCCESSFUL).map((p) => Number(p.amount));
    const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
    if (outstandingBalance <= 0) {
      throw new BadRequestException("This invoice has no outstanding balance");
    }

    const key = `payment-proofs/${invoice.id}/${Date.now()}-${file.originalname}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    const proofOfPaymentUrl = await this.storage.getSignedUrl(key, SIGNED_URL_TTL_SECONDS);

    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });

    return this.prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: dto.amount,
        method: PaymentMethod.BANK_TRANSFER_MANUAL,
        status: PaymentStatus.PENDING_APPROVAL,
        proofOfPaymentUrl,
        recordedByStaffId: staffProfile?.id ?? null,
      },
      include: PAYMENT_DETAIL_INCLUDE,
    });
  }

  /**
   * PRD FR7.3b: Super-Admin only (enforced in the controller, not here — see
   * PaymentController.approveManualBankTransfer). Same $transaction shape as
   * recordCash/resolveGatewayOutcome: update Payment, recompute the
   * invoice's balance/status, create a Receipt, enqueue PDF generation.
   */
  async approveManualBankTransfer(paymentId: string, reviewerUserId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { invoice: { include: { lineItems: true, payments: true } } },
    });
    if (payment.method !== PaymentMethod.BANK_TRANSFER_MANUAL || payment.status !== PaymentStatus.PENDING_APPROVAL) {
      throw new BadRequestException("Only a PENDING_APPROVAL manual bank-transfer payment can be approved");
    }

    const invoice = payment.invoice;
    const paidAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCESSFUL, reviewedByUserId: reviewerUserId, reviewedAt: paidAt, paidAt },
      });

      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = [
        ...invoice.payments.filter((p) => p.status === PaymentStatus.SUCCESSFUL && p.id !== payment.id).map((p) => Number(p.amount)),
        Number(payment.amount),
      ];
      const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
      const paidTotal = successfulPaymentAmounts.reduce((sum, amount) => sum + amount, 0);
      const status = computeInvoiceStatus(outstandingBalance, paidTotal, invoice.dueDate, paidAt);

      await tx.invoice.update({ where: { id: invoice.id }, data: { status } });

      const receipt = await tx.receipt.create({
        data: {
          paymentId: updatedPayment.id,
          receiptNumber: `RCT-${updatedPayment.id.slice(0, 8).toUpperCase()}`,
          issuedAt: paidAt,
        },
      });

      return { payment: updatedPayment, receipt, invoiceStatus: status, outstandingBalance };
    });

    await this.receiptQueue.add("generate", { receiptId: result.receipt.id });

    return result;
  }

  /** PRD FR7.3b: Super-Admin only (enforced in the controller). No invoice/receipt change — a rejected submission never counted toward the balance. */
  async rejectManualBankTransfer(paymentId: string, reviewerUserId: string, rejectionReason: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.method !== PaymentMethod.BANK_TRANSFER_MANUAL || payment.status !== PaymentStatus.PENDING_APPROVAL) {
      throw new BadRequestException("Only a PENDING_APPROVAL manual bank-transfer payment can be rejected");
    }

    return this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.REJECTED, reviewedByUserId: reviewerUserId, reviewedAt: new Date(), rejectionReason },
    });
  }

  async findAllForUser(
    user: RequestUser,
    ability: AppAbility,
    filters: { invoiceId?: string; studentId?: string; status?: PaymentStatus; skip?: number; take?: number } = {},
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
        filters.status ? { status: filters.status } : {},
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

  @Post("gateway-checkout")
  @CheckPolicies((ability) => ability.can("read", "Invoice"))
  initiateGatewayCheckout(@Body() dto: InitiateGatewayCheckoutDto, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.initiateGatewayCheckout(dto, user, ability);
  }

  @Post("bank-transfer")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PROOF_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_PROOF_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException("Proof of payment must be a JPEG, PNG, WebP image, or PDF"), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  @CheckPolicies((ability) => ability.can("manage", "Payment"))
  submitManualBankTransfer(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SubmitManualBankTransferDto,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) {
      throw new BadRequestException("Proof of payment file is required");
    }
    return this.service.submitManualBankTransfer(dto, file, user);
  }

  /** Super-Admin-only carve-out — same manual role-check pattern as identity/ownership-transfer.ts and term-report-card.ts's remove(), not a CASL condition (Bursar's own "manage Payment" grant would otherwise satisfy any CASL check on this same subject). */
  @Patch(":id/approve")
  approveManualBankTransfer(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only the Super-Admin can approve a manual bank-transfer payment");
    }
    return this.service.approveManualBankTransfer(id, user.id);
  }

  /** Super-Admin-only carve-out — see approveManualBankTransfer's comment. */
  @Patch(":id/reject")
  rejectManualBankTransfer(@Param("id") id: string, @Body() dto: RejectPaymentDto, @CurrentUser() user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only the Super-Admin can reject a manual bank-transfer payment");
    }
    return this.service.rejectManualBankTransfer(id, user.id, dto.rejectionReason);
  }

  @Get()
  @CheckPolicies((ability) => ability.can("read", "Payment"))
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("invoiceId") invoiceId?: string,
    @Query("studentId") studentId?: string,
    @Query("status") status?: PaymentStatus,
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
  @CheckPolicies((ability) => ability.can("read", "Payment"))
  findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    return this.service.findOneForUser(id, user, ability);
  }
}
