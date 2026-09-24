import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { InjectQueue } from "@nestjs/bullmq";
import { randomBytes } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { memoryStorage } from "multer";
import { NotificationType, PaymentGatewayProvider, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import {
  computeInvoiceStatus,
  computeOutstandingBalance,
  formatPersonName,
  QUEUE_NAMES,
  type ReceiptGenerationJob,
} from "@school/types";
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
import { Audited } from "../audit/audited.decorator";
import { NotificationService } from "../notifications/notification";
import { RecordCashPaymentDto } from "./dto/record-cash-payment.dto";
import { InitiateGatewayCheckoutDto } from "./dto/initiate-gateway-checkout.dto";
import { SubmitManualBankTransferDto } from "./dto/submit-manual-bank-transfer.dto";
import { RejectPaymentDto } from "./dto/reject-payment.dto";
import { ReversePaymentDto } from "./dto/reverse-payment.dto";
import { PaymentGatewayCredentialsService } from "./gateway/payment-gateway-credentials";
import { PAYMENT_GATEWAY_ADAPTER } from "./gateway/payment-gateway.tokens";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter";
import { renderBulkReceiptsPdf, type BulkReceiptPdfEntry } from "./receipt-bulk-pdf.util";

const PAYMENT_DETAIL_INCLUDE = {
  receipt: true,
  invoice: { include: { student: { include: { user: true, guardians: true } } } },
} satisfies Prisma.PaymentInclude;

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_PROOF_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROOF_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly credentials: PaymentGatewayCredentialsService,
    @InjectQueue(QUEUE_NAMES.RECEIPT_GENERATION) private readonly receiptQueue: Queue<ReceiptGenerationJob>,
    @Inject(PAYMENT_GATEWAY_ADAPTER) private readonly gatewayAdapter: PaymentGatewayAdapter,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly notifications: NotificationService,
  ) {}

  /** Same "never let a notification failure fail the real write" contract as DiscountRequestService.notifySafely. */
  private async notifySafely(recipientUserId: string, type: NotificationType, vars: Record<string, string | number>) {
    try {
      await this.notifications.notify(recipientUserId, type, vars);
    } catch (error) {
      this.logger.warn(`Failed to notify ${recipientUserId} of ${type}: ${String(error)}`);
    }
  }

  private async resolveStaffUserId(staffProfileId: string | null): Promise<string | null> {
    if (!staffProfileId) return null;
    const staff = await this.prisma.staffProfile.findUnique({ where: { id: staffProfileId } });
    return staff?.userId ?? null;
  }

  /**
   * Audit-facing complement to the UUID-derived receiptNumber (see Receipt's
   * own schema comment) — a per-AcademicSession sequential serial, so a
   * Bursar/auditor can spot a gap in a session's run. The INSERT ... ON
   * CONFLICT DO UPDATE ... RETURNING is a single atomic statement under
   * Postgres row-level locking, so two payments settling in the same
   * session at the same instant can never be handed the same number — a
   * plain read-then-increment would have exactly that race. Always called
   * with the same `tx` the enclosing Receipt.create runs in, so the counter
   * bump and the receipt row commit or roll back together.
   */
  private async nextReceiptSerial(
    tx: Prisma.TransactionClient,
    academicSessionId: string,
    academicSessionName: string,
  ): Promise<{ sequenceNumber: number; serialNumber: string }> {
    const [row] = await tx.$queryRaw<Array<{ lastNumber: number }>>`
      INSERT INTO "receipt_sequences" ("academicSessionId", "lastNumber")
      VALUES (${academicSessionId}, 1)
      ON CONFLICT ("academicSessionId")
      DO UPDATE SET "lastNumber" = "receipt_sequences"."lastNumber" + 1
      RETURNING "lastNumber"
    `;
    const sequenceNumber = row!.lastNumber;
    const serialNumber = `${academicSessionName}-${String(sequenceNumber).padStart(5, "0")}`;
    return { sequenceNumber, serialNumber };
  }

  /**
   * A student must clear every earlier term's invoice before a payment can
   * be started against a later one — "earlier" is derived from Term.startDate
   * since terms have no explicit ordinal, and this holds across academic
   * sessions too. Checked at payment-initiation only (recordCash,
   * initiateGatewayCheckout, submitManualBankTransfer), not at
   * resolution/approval (resolveGatewayOutcome, approvePayment) — those
   * finalize a payment already permitted at submission time.
   */
  private async assertNoEarlierUnsettledInvoice(studentId: string, termStartDate: Date): Promise<void> {
    const earlierInvoices = await this.prisma.invoice.findMany({
      where: { studentId, term: { startDate: { lt: termStartDate } } },
      include: { lineItems: true, payments: true },
    });

    const hasUnsettled = earlierInvoices.some((invoice) => {
      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = invoice.payments
        .filter((p) => p.status === PaymentStatus.SUCCESSFUL)
        .map((p) => Number(p.amount));
      return computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts) > 0;
    });

    if (hasUnsettled) {
      throw new BadRequestException("This student has an unsettled invoice from an earlier term — settle it before paying a later term's invoice");
    }
  }

  /**
   * A Bursar recording CASH is only claiming money was handed to them — like
   * a manual bank-transfer submission, that claim needs a Super-Admin's
   * independent confirmation before it counts toward the invoice, so this
   * starts PENDING_APPROVAL and deliberately does NOT touch the invoice's
   * balance/status or create a Receipt until approvePayment runs (this was
   * previously SUCCESSFUL-on-write per PRD §3.9's original text — amended
   * alongside this change). Same shape as submitManualBankTransfer minus the
   * file upload. No assignment-type scoping is needed here (unlike
   * Attendance's per-student-scoped writes) — CASL already fully gates who
   * can reach this endpoint (Bursar/Super-Admin, domain-wide), so
   * `recordedByStaffId` just resolves to the caller's own StaffProfile if
   * they have one, `null` otherwise (Super-Admin override, same as
   * ScoreEntry.enteredByStaffId).
   */
  async recordCash(dto: RecordCashPaymentDto, user: RequestUser) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: dto.invoiceId },
      include: { lineItems: true, payments: true, term: true },
    });
    await this.assertNoEarlierUnsettledInvoice(invoice.studentId, invoice.term.startDate);

    const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
    const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === PaymentStatus.SUCCESSFUL).map((p) => Number(p.amount));
    const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
    if (outstandingBalance <= 0) {
      throw new BadRequestException("This invoice has no outstanding balance");
    }

    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });

    return this.prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: dto.amount,
        method: PaymentMethod.CASH,
        status: PaymentStatus.PENDING_APPROVAL,
        recordedByStaffId: staffProfile?.id ?? null,
      },
      include: PAYMENT_DETAIL_INCLUDE,
    });
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
      include: { lineItems: true, payments: true, term: true, student: { include: { guardians: true } } },
    });
    await this.assertNoEarlierUnsettledInvoice(invoice.studentId, invoice.term.startDate);

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

    // A fresh reference is minted on every checkout attempt, never reused
    // (PRD §3.9) — Paystack's transaction/initialize permanently rejects a
    // reference it has seen before, even from an abandoned/incomplete prior
    // attempt, so reusing one across retries locks the parent out after the
    // first attempt. Only the current/live reference needs to resolve later:
    // resolveGatewayOutcome matches by invoiceId + PENDING + provider, not
    // by reference, and webhook/reconciliation both read the live value.
    const reference = `INV-${invoice.id}-${Date.now()}-${randomBytes(4).toString("hex")}`;
    await this.prisma.invoice.update({ where: { id: invoice.id }, data: { gatewayPaymentReference: reference } });

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
      customerName: formatPersonName(payer),
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
      include: { lineItems: true, payments: true, term: { include: { academicSession: true } }, student: { include: { user: true } } },
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

      const { sequenceNumber, serialNumber } = await this.nextReceiptSerial(tx, invoice.term.academicSessionId, invoice.term.academicSession.name);
      const receipt = await tx.receipt.create({
        data: {
          paymentId: updatedPayment.id,
          receiptNumber: `RCT-${updatedPayment.id.slice(0, 8).toUpperCase()}`,
          academicSessionId: invoice.term.academicSessionId,
          sequenceNumber,
          serialNumber,
          issuedAt: paidAt,
        },
      });

      return { receipt };
    });

    await this.receiptQueue.add("generate", { receiptId: txResult.receipt.id });

    if (payment.paidByUserId) {
      const studentName = formatPersonName(invoice.student.user);
      const formattedAmount = result.amountPaid.toLocaleString("en-NG", { style: "currency", currency: "NGN" });
      await this.notifySafely(payment.paidByUserId, "PAYMENT_RECEIVED", { amount: formattedAmount, studentName });
    }

    return { handled: true };
  }

  /**
   * PRD FR7.3a/ARCHITECTURE §10.2: a parent paid directly into the school's
   * bank account outside the platform and sent proof to the Bursar — there's
   * no gateway transaction to trust, so this starts PENDING_APPROVAL and
   * deliberately does NOT touch the invoice's balance/status until a
   * Super-Admin reviews it (approvePayment/rejectPayment below). Same
   * `recordedByStaffId` resolution as recordCash.
   */
  async submitManualBankTransfer(dto: SubmitManualBankTransferDto, file: Express.Multer.File, user: RequestUser) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: dto.invoiceId },
      include: { lineItems: true, payments: true, term: true },
    });
    await this.assertNoEarlierUnsettledInvoice(invoice.studentId, invoice.term.startDate);

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
   * PRD FR7.3b (extended to also cover CASH — see recordCash's comment):
   * Super-Admin only (enforced in the controller, not here — see
   * PaymentController.approvePayment). Same $transaction shape as
   * resolveGatewayOutcome: update Payment, recompute the invoice's
   * balance/status, create a Receipt, enqueue PDF generation. Also notifies
   * the student's guardians of the confirmed payment — CASH's own
   * PAYMENT_RECEIVED notification used to fire at recordCash-time before
   * approval was required; it now fires here instead, once the money is
   * actually confirmed, and this closes the same gap for manual bank
   * transfers (which never notified guardians at all).
   */
  async approvePayment(paymentId: string, reviewerUserId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        invoice: {
          include: {
            lineItems: true,
            payments: true,
            term: { include: { academicSession: true } },
            student: { include: { user: true, guardians: { include: { parent: true } } } },
          },
        },
      },
    });
    if (
      (payment.method !== PaymentMethod.CASH && payment.method !== PaymentMethod.BANK_TRANSFER_MANUAL) ||
      payment.status !== PaymentStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException("Only a PENDING_APPROVAL cash or manual bank-transfer payment can be approved");
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

      const { sequenceNumber, serialNumber } = await this.nextReceiptSerial(tx, invoice.term.academicSessionId, invoice.term.academicSession.name);
      const receipt = await tx.receipt.create({
        data: {
          paymentId: updatedPayment.id,
          receiptNumber: `RCT-${updatedPayment.id.slice(0, 8).toUpperCase()}`,
          academicSessionId: invoice.term.academicSessionId,
          sequenceNumber,
          serialNumber,
          issuedAt: paidAt,
        },
      });

      return { payment: updatedPayment, receipt, invoiceStatus: status, outstandingBalance };
    });

    await this.receiptQueue.add("generate", { receiptId: result.receipt.id });

    const studentName = formatPersonName(invoice.student.user);
    const formattedAmount = Number(payment.amount).toLocaleString("en-NG", { style: "currency", currency: "NGN" });
    const bursarUserId = await this.resolveStaffUserId(payment.recordedByStaffId);
    if (bursarUserId) {
      await this.notifySafely(bursarUserId, "MANUAL_PAYMENT_APPROVED", { amount: formattedAmount, studentName });
    }
    // paidByUserId is currently always null for a manual-transfer submission
    // (submitManualBankTransfer never sets it) — written correctly so this
    // "just works" if that ever changes, but dormant today.
    if (payment.paidByUserId) {
      await this.notifySafely(payment.paidByUserId, "MANUAL_PAYMENT_APPROVED", { amount: formattedAmount, studentName });
    }
    for (const guardian of invoice.student.guardians) {
      await this.notifySafely(guardian.parent.userId, "PAYMENT_RECEIVED", { amount: formattedAmount, studentName });
    }

    return result;
  }

  /** PRD FR7.3b (extended to also cover CASH — see recordCash's comment): Super-Admin only (enforced in the controller). No invoice/receipt change — a rejected submission never counted toward the balance. */
  async rejectPayment(paymentId: string, reviewerUserId: string, rejectionReason: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { invoice: { include: { student: { include: { user: true } } } } },
    });
    if (
      (payment.method !== PaymentMethod.CASH && payment.method !== PaymentMethod.BANK_TRANSFER_MANUAL) ||
      payment.status !== PaymentStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException("Only a PENDING_APPROVAL cash or manual bank-transfer payment can be rejected");
    }

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.REJECTED, reviewedByUserId: reviewerUserId, reviewedAt: new Date(), rejectionReason },
    });

    const bursarUserId = await this.resolveStaffUserId(payment.recordedByStaffId);
    if (bursarUserId) {
      const studentName = formatPersonName(payment.invoice.student.user);
      await this.notifySafely(bursarUserId, "MANUAL_PAYMENT_REJECTED", {
        amount: Number(payment.amount).toLocaleString("en-NG", { style: "currency", currency: "NGN" }),
        studentName,
        reason: rejectionReason,
      });
    }

    return updated;
  }

  /**
   * Super-Admin-only correction path (PRD gap discovered in the field: a
   * Bursar mis-keyed a CASH amount and the invoice was marked PAID against
   * money never actually received). Never edits a Payment's amount in
   * place — that would erase what was literally recorded at the time and
   * break the receipt/audit trail already issued against it. Instead the
   * wrong payment is marked REVERSED (excluded from every
   * successfulPaymentAmounts sum from this point on, same as
   * FAILED/REJECTED/PENDING) and the Bursar records a fresh, correct-amount
   * payment separately via recordCash/submitManualBankTransfer. Only a
   * SUCCESSFUL payment can be reversed — PENDING/FAILED/REJECTED never
   * touched the invoice's balance, and an already-REVERSED payment reversing
   * again would double-subtract.
   */
  async reversePayment(paymentId: string, reviewerUserId: string, reason: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        invoice: {
          include: { lineItems: true, payments: true, term: true, student: { include: { user: true } } },
        },
      },
    });
    if (payment.status !== PaymentStatus.SUCCESSFUL) {
      throw new BadRequestException("Only a SUCCESSFUL payment can be reversed");
    }
    // A gateway payment (CARD/TRANSFER/USSD/RESERVED_ACCOUNT) is verified
    // independently by the provider — the amount that landed on the invoice
    // is exactly what the gateway confirmed, not something the Bursar keyed
    // in, so there's nothing here for a Super-Admin to correct. Reversal is
    // scoped to the two staff-entered paths where a typo/mis-record is
    // actually possible: CASH and manual bank transfer, both settled via
    // approvePayment.
    if (payment.method !== PaymentMethod.CASH && payment.method !== PaymentMethod.BANK_TRANSFER_MANUAL) {
      throw new BadRequestException("Only a CASH or bank-transfer payment can be reversed");
    }

    const invoice = payment.invoice;
    const reversedAt = new Date();

    const updatedPayment = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REVERSED, reversedByUserId: reviewerUserId, reversedAt, reversalReason: reason },
      });

      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = invoice.payments
        .filter((p) => p.status === PaymentStatus.SUCCESSFUL && p.id !== payment.id)
        .map((p) => Number(p.amount));
      const outstandingBalance = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);
      const paidTotal = successfulPaymentAmounts.reduce((sum, amount) => sum + amount, 0);
      const status = computeInvoiceStatus(outstandingBalance, paidTotal, invoice.dueDate, reversedAt);

      await tx.invoice.update({ where: { id: invoice.id }, data: { status } });

      return updated;
    });

    const bursarUserId = await this.resolveStaffUserId(payment.recordedByStaffId);
    if (bursarUserId) {
      const studentName = formatPersonName(invoice.student.user);
      await this.notifySafely(bursarUserId, "PAYMENT_REVERSED", {
        amount: Number(payment.amount).toLocaleString("en-NG", { style: "currency", currency: "NGN" }),
        studentName,
        reason,
      });
    }

    return updatedPayment;
  }

  /**
   * Bursar's "print and sign" flow: renders the selected SUCCESSFUL
   * payments' receipts 3-to-a-page for physical printing (receipt-bulk-
   * pdf.util.ts), in the caller's selection order. A paymentId that doesn't
   * resolve to a SUCCESSFUL payment with a receipt is silently dropped
   * rather than failing the whole batch — same resilience pattern as
   * exam-scheduling's persistClassTimetableRows.
   *
   * Marks each receipt's Receipt.printedAt/printCount as it goes: the first
   * time a given receipt passes through here it's an original; any time
   * after that (this call or a later one) it's stamped "DUPLICATE COPY" on
   * the slip, so a Bursar can never hand out a second physical original
   * without it being visibly marked as a copy.
   */
  async buildBulkReceiptsPdf(paymentIds: string[]): Promise<Buffer> {
    const payments = await this.prisma.payment.findMany({
      where: { id: { in: paymentIds }, status: PaymentStatus.SUCCESSFUL },
      include: {
        receipt: true,
        recordedByStaff: { include: { user: true } },
        invoice: {
          include: { lineItems: true, payments: true, term: { include: { academicSession: true } }, student: { include: { user: true } } },
        },
      },
    });
    const byId = new Map(payments.map((payment) => [payment.id, payment]));
    const ordered = paymentIds.map((id) => byId.get(id)).filter((payment): payment is (typeof payments)[number] => payment?.receipt != null);

    const entries: BulkReceiptPdfEntry[] = [];
    for (const payment of ordered) {
      const receipt = payment.receipt!;
      const isReprint = receipt.printedAt !== null;
      const updated = await this.prisma.receipt.update({
        where: { id: receipt.id },
        data: { printedAt: receipt.printedAt ?? new Date(), printCount: { increment: 1 } },
      });

      const { invoice } = payment;
      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = invoice.payments.filter((p) => p.status === PaymentStatus.SUCCESSFUL).map((p) => Number(p.amount));
      const outstandingBalanceAfter = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);

      entries.push({
        receiptNumber: receipt.receiptNumber,
        serialNumber: receipt.serialNumber,
        issuedAt: receipt.issuedAt,
        studentName: formatPersonName(invoice.student.user),
        admissionNumber: invoice.student.admissionNumber,
        termName: invoice.term.name,
        academicSessionName: invoice.term.academicSession.name,
        amount: Number(payment.amount),
        method: payment.method,
        paidAt: payment.paidAt,
        outstandingBalanceAfter,
        recordedByName: payment.recordedByStaff ? formatPersonName(payment.recordedByStaff.user) : null,
        isReprint,
        printCount: updated.printCount,
      });
    }

    const school = await this.prisma.schoolProfile.findFirstOrThrow();
    return renderBulkReceiptsPdf(entries, {
      name: school.name,
      address: school.address,
      contactEmail: school.contactEmail,
      contactPhone: school.contactPhone,
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
  @Audited("Payment")
  recordCash(@Body() dto: RecordCashPaymentDto, @CurrentUser() user: RequestUser) {
    return this.service.recordCash(dto, user);
  }

  @Post("gateway-checkout")
  @CheckPolicies((ability) => ability.can("read", "Invoice"))
  @Audited("Payment")
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
  @Audited("Payment", "payment")
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

  /** Super-Admin-only carve-out — same manual role-check pattern as identity/ownership-transfer.ts and term-report-card.ts's remove(), not a CASL condition (Bursar's own "manage Payment" grant would otherwise satisfy any CASL check on this same subject). Covers both CASH and BANK_TRANSFER_MANUAL — see PaymentService.approvePayment's comment. */
  @Patch(":id/approve")
  @Audited("Payment", "payment")
  approvePayment(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only the Super-Admin can approve a cash or manual bank-transfer payment");
    }
    return this.service.approvePayment(id, user.id);
  }

  /** Super-Admin-only carve-out — see approvePayment's comment. */
  @Patch(":id/reject")
  @Audited("Payment", "payment")
  rejectPayment(@Param("id") id: string, @Body() dto: RejectPaymentDto, @CurrentUser() user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only the Super-Admin can reject a cash or manual bank-transfer payment");
    }
    return this.service.rejectPayment(id, user.id, dto.rejectionReason);
  }

  /** Super-Admin-only carve-out — see approvePayment's comment. */
  @Patch(":id/reverse")
  @Audited("Payment", "payment")
  reversePayment(@Param("id") id: string, @Body() dto: ReversePaymentDto, @CurrentUser() user: RequestUser) {
    if (!user.roles.includes("SUPER_ADMIN")) {
      throw new ForbiddenException("Only the Super-Admin can reverse a payment");
    }
    return this.service.reversePayment(id, user.id, dto.reason);
  }

  /**
   * Bursar/Super-Admin only (same "manage" gate as recordCash) — this
   * produces official signable paper, not a self-service download, so it's
   * not opened up to a parent's own "read" grant the way findOne/findAll are.
   */
  @Get("receipts/bulk-print")
  @CheckPolicies((ability) => ability.can("manage", "Payment"))
  async bulkPrintReceipts(@Query("paymentIds") paymentIds?: string) {
    const ids = (paymentIds ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      throw new BadRequestException("paymentIds (comma-separated) is required");
    }
    const buffer = await this.service.buildBulkReceiptsPdf(ids);
    return new StreamableFile(buffer, { type: "application/pdf", disposition: 'attachment; filename="receipts.pdf"' });
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
