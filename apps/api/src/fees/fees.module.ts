import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { QUEUE_NAMES } from "@school/types";
import { MonnifyAdapter, PaystackAdapter, type PaymentGatewayAdapter } from "@school/types/payment-gateways";
import { FeeStructureController, FeeStructureService } from "./fee-structure";
import { FeeStructureStudentAssignmentController, FeeStructureStudentAssignmentService } from "./fee-structure-student-assignment";
import { InvoiceController, InvoiceService } from "./invoice";
import { PaymentController, PaymentService } from "./payment";
import { DiscountRequestController, DiscountRequestService } from "./discount-request";
import { PaymentGatewayWebhookController } from "./payment-gateway-webhook";
import { PaymentGatewayConfigController, PaymentGatewayConfigService } from "./gateway/payment-gateway-config";
import { PaymentGatewayCredentialsService } from "./gateway/payment-gateway-credentials";
import { MONNIFY_ADAPTER, PAYMENT_GATEWAY_ADAPTER, PAYSTACK_ADAPTER } from "./gateway/payment-gateway.tokens";
import { AcademicStructureModule } from "../academic-structure/academic-structure.module";
import { NotificationsModule } from "../notifications/notifications.module";

// Maps to ARCHITECTURE.md §5's FeesModule — depends on AcademicStructureModule
// (Term/ClassLevel/AcademicSession) and dispatches to apps/worker's new
// ReceiptModule via the receipt-generation queue, same producer/consumer
// split as AssessmentsModule's report-card-generation queue.
//
// Phase 5 Slice 2b: both adapters are always registered (a webhook or the
// reconciliation sweep may need to resolve either one, regardless of which
// is "active"); PAYMENT_GATEWAY_ADAPTER — used only for NEW checkouts — is
// a useFactory picking between them based on PAYMENT_GATEWAY_PROVIDER
// (ARCHITECTURE §5/§10, default MONNIFY).
@Module({
  imports: [AcademicStructureModule, NotificationsModule, BullModule.registerQueue({ name: QUEUE_NAMES.RECEIPT_GENERATION })],
  controllers: [
    FeeStructureController,
    FeeStructureStudentAssignmentController,
    InvoiceController,
    PaymentController,
    DiscountRequestController,
    PaymentGatewayWebhookController,
    PaymentGatewayConfigController,
  ],
  providers: [
    FeeStructureService,
    FeeStructureStudentAssignmentService,
    InvoiceService,
    PaymentService,
    DiscountRequestService,
    PaymentGatewayConfigService,
    PaymentGatewayCredentialsService,
    { provide: MONNIFY_ADAPTER, useValue: new MonnifyAdapter() },
    { provide: PAYSTACK_ADAPTER, useValue: new PaystackAdapter() },
    {
      provide: PAYMENT_GATEWAY_ADAPTER,
      useFactory: (config: ConfigService, monnify: PaymentGatewayAdapter, paystack: PaymentGatewayAdapter) =>
        config.get<string>("PAYMENT_GATEWAY_PROVIDER", "MONNIFY") === "PAYSTACK" ? paystack : monnify,
      inject: [ConfigService, MONNIFY_ADAPTER, PAYSTACK_ADAPTER],
    },
  ],
})
export class FeesModule {}
