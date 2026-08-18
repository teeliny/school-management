import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { PaymentStatus } from "@prisma/client";
import { computeOutstandingBalance, QUEUE_NAMES, type ReceiptGenerationJob } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter";
import { renderReceiptPdf } from "./receipt-pdf.util";

const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * PRD FR7.4a: a Receipt is created synchronously (apps/api's PaymentService,
 * the moment a Payment reaches SUCCESSFUL) with `pdfUrl: null` — this
 * processor renders and stores the PDF afterward, same async
 * dispatch/render split as report-card generation (report-card.processor.ts).
 */
@Processor(QUEUE_NAMES.RECEIPT_GENERATION)
export class ReceiptProcessor extends WorkerHost {
  private readonly logger = new Logger(ReceiptProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {
    super();
  }

  async process(job: Job<ReceiptGenerationJob>): Promise<void> {
    const receipt = await this.prisma.receipt.findUniqueOrThrow({
      where: { id: job.data.receiptId },
      include: {
        payment: {
          include: {
            recordedByStaff: { include: { user: true } },
            invoice: {
              include: {
                student: { include: { user: true } },
                term: true,
                lineItems: true,
                payments: true,
              },
            },
          },
        },
      },
    });

    const { payment } = receipt;
    const { invoice } = payment;
    const school = await this.prisma.schoolProfile.findFirstOrThrow();

    // Only DISCOUNT-type lines feed the formula — totalAmount already
    // includes every FEE-type line at generation time (see the Invoice
    // model comment in prisma/schema.prisma), so summing them again here
    // would double-count.
    const discountAmounts = invoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
    const successfulPaymentAmounts = invoice.payments
      .filter((p) => p.status === PaymentStatus.SUCCESSFUL)
      .map((p) => Number(p.amount));
    const outstandingBalanceAfter = computeOutstandingBalance(Number(invoice.totalAmount), discountAmounts, successfulPaymentAmounts);

    const pdfBuffer = await renderReceiptPdf({
      receiptNumber: receipt.receiptNumber,
      issuedAt: receipt.issuedAt,
      schoolName: school.name,
      schoolAddress: school.address,
      studentName: `${invoice.student.user.firstName} ${invoice.student.user.lastName}`,
      admissionNumber: invoice.student.admissionNumber,
      termName: invoice.term.name,
      amount: Number(payment.amount),
      method: payment.method,
      paidAt: payment.paidAt,
      outstandingBalanceAfter,
      recordedByName: payment.recordedByStaff
        ? `${payment.recordedByStaff.user.firstName} ${payment.recordedByStaff.user.lastName}`
        : null,
    });

    const key = `receipts/${receipt.id}.pdf`;
    await this.storage.put(key, pdfBuffer, "application/pdf");
    const pdfUrl = await this.storage.getSignedUrl(key, SIGNED_URL_TTL_SECONDS);

    await this.prisma.receipt.update({ where: { id: receipt.id }, data: { pdfUrl } });

    this.logger.log(`Generated receipt PDF for receipt ${receipt.id}`);
  }
}
