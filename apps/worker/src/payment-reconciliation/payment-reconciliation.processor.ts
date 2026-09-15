import { Inject, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import { PaymentGatewayProvider, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { computeInvoiceStatus, computeOutstandingBalance, QUEUE_NAMES, type ReceiptGenerationJob } from "@school/types";
import {
  GatewayTransactionNotFoundError,
  mapChannelToPaymentMethod,
  type GatewayTransactionResult,
  type PaymentGatewayAdapter,
} from "@school/types/payment-gateways";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentGatewayCredentialsService } from "./payment-gateway-credentials";
import { MONNIFY_ADAPTER, PAYSTACK_ADAPTER } from "./payment-gateway.tokens";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const REPEATABLE_JOB_ID = "payment-reconciliation-repeatable";
const STUCK_THRESHOLD_MS = 15 * 60 * 1000;
// Only for a GatewayTransactionNotFoundError, never a generic/transient
// failure (network blip, expired credentials, 5xx) — those say nothing
// about the payment's real status and must keep retrying indefinitely. A
// "not found" is different: a reference obtained from our own
// initTransaction call exists on the gateway's side immediately, so this
// only means the checkout was never truly completed there. One hour (well
// past STUCK_THRESHOLD_MS) rules out any eventual-consistency lag before
// giving up.
const NOT_FOUND_GIVE_UP_MS = 60 * 60 * 1000;

const GATEWAY_METHODS: PaymentMethod[] = [
  PaymentMethod.GATEWAY_CARD,
  PaymentMethod.GATEWAY_TRANSFER,
  PaymentMethod.GATEWAY_USSD,
  PaymentMethod.GATEWAY_RESERVED_ACCOUNT,
];

/**
 * PRD FR7.6/ARCHITECTURE §10.1: covers the case where a gateway webhook is
 * lost to a network blip — polls the active gateway's transaction-status API
 * (via the same adapter apps/api's webhook handler uses) for any Payment
 * still PENDING past 15 minutes, so a parent's payment is never silently
 * stuck. Each Payment records which gatewayProvider it went through, so
 * this always polls the correct provider's API even for a payment initiated
 * before the school last switched its default (not necessarily the
 * currently-"active" one).
 *
 * The resolve-outcome logic below (idempotency check, Payment/Invoice/
 * Receipt update, receipt-generation enqueue) is a duplicate of apps/api's
 * PaymentService.resolveGatewayOutcome — apps/worker can't import apps/api's
 * NestJS providers (separate process), same cross-process boundary
 * BroadsheetService's reimplementation of computeAnnualSummary already
 * established. Only the pure computeOutstandingBalance/computeInvoiceStatus/
 * mapChannelToPaymentMethod formulas are actually shared, via @school/types.
 */
@Processor(QUEUE_NAMES.PAYMENT_RECONCILIATION)
export class PaymentReconciliationProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PaymentReconciliationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: PaymentGatewayCredentialsService,
    @InjectQueue(QUEUE_NAMES.PAYMENT_RECONCILIATION) private readonly sweepQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RECEIPT_GENERATION) private readonly receiptQueue: Queue<ReceiptGenerationJob>,
    @Inject(MONNIFY_ADAPTER) private readonly monnify: PaymentGatewayAdapter,
    @Inject(PAYSTACK_ADAPTER) private readonly paystack: PaymentGatewayAdapter,
  ) {
    super();
  }

  async onModuleInit() {
    await this.sweepQueue.add("reconcile", {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: REPEATABLE_JOB_ID });
  }

  async process(_job: Job): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuckPayments = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.PENDING, method: { in: GATEWAY_METHODS }, gatewayProvider: { not: null }, createdAt: { lt: cutoff } },
      include: { invoice: true },
    });

    let resolved = 0;
    for (const payment of stuckPayments) {
      if (!payment.gatewayProvider || !payment.invoice.gatewayPaymentReference) continue;

      // One payment's failure (unregistered provider, expired/rotated
      // credentials, a transient network error) must not abort the rest of
      // this batch — each is independent, and the sweep will simply retry
      // an unresolved one again next tick.
      try {
        const adapter = this.adapterFor(payment.gatewayProvider);
        const credentials = await this.credentials.getCredentials(payment.gatewayProvider);
        const result = await adapter.verifyTransaction(credentials, payment.invoice.gatewayPaymentReference);

        if (result.status !== "PENDING") {
          await this.resolveGatewayOutcome(payment.invoiceId, payment.gatewayProvider, result);
          resolved++;
        }
      } catch (error) {
        const age = Date.now() - payment.createdAt.getTime();
        if (error instanceof GatewayTransactionNotFoundError && age > NOT_FOUND_GIVE_UP_MS) {
          this.logger.warn(
            `Giving up on payment ${payment.id}: ${error.message} (stuck ${Math.round(age / (60 * 1000))}m with no matching gateway transaction) — marking FAILED`,
          );
          await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
          resolved++;
          continue;
        }
        this.logger.error(`Failed to reconcile payment ${payment.id}: ${error}`);
      }
    }

    if (stuckPayments.length > 0) {
      this.logger.log(`Reconciliation checked ${stuckPayments.length} stuck payment(s), resolved ${resolved}`);
    }
  }

  private adapterFor(provider: PaymentGatewayProvider): PaymentGatewayAdapter {
    if (provider === PaymentGatewayProvider.MONNIFY) return this.monnify;
    if (provider === PaymentGatewayProvider.PAYSTACK) return this.paystack;
    throw new Error(`No adapter registered for provider ${provider}`);
  }

  /**
   * Duplicate of apps/api's PaymentService.nextReceiptSerial — same cross-
   * process boundary reasoning as this file's own header comment (apps/worker
   * can't import apps/api's providers). Atomic per-AcademicSession counter
   * backing Receipt.serialNumber; see PaymentService.nextReceiptSerial's own
   * comment for why a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING
   * is race-safe where a read-then-increment wouldn't be.
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

  private async resolveGatewayOutcome(
    invoiceId: string,
    provider: PaymentGatewayProvider,
    result: GatewayTransactionResult,
  ): Promise<void> {
    if (result.status === "SUCCESSFUL") {
      const alreadyProcessed = await this.prisma.payment.findFirst({
        where: { gatewayTransactionReference: result.gatewayTransactionReference, status: PaymentStatus.SUCCESSFUL },
      });
      if (alreadyProcessed) return;
    }

    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lineItems: true, payments: true, term: { include: { academicSession: true } } },
    });

    const payment = invoice.payments.find((p) => p.status === PaymentStatus.PENDING && p.gatewayProvider === provider);
    if (!payment) return;

    if (result.status === "FAILED") {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, gatewayTransactionReference: result.gatewayTransactionReference },
      });
      return;
    }

    const method = mapChannelToPaymentMethod(result.channel);
    const paidAt = result.paidAt ?? new Date();

    const txResult = await this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCESSFUL, gatewayTransactionReference: result.gatewayTransactionReference, paidAt, method },
      });

      const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
      const successfulPaymentAmounts = [
        ...invoice.payments.filter((p) => p.status === PaymentStatus.SUCCESSFUL && p.id !== payment.id).map((p) => Number(p.amount)),
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
  }
}
