import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { MonnifyAdapter, PaystackAdapter, QUEUE_NAMES } from "@school/types";
import { PaymentReconciliationProcessor } from "./payment-reconciliation.processor";
import { PaymentGatewayCredentialsService } from "./payment-gateway-credentials";
import { MONNIFY_ADAPTER, PAYSTACK_ADAPTER } from "./payment-gateway.tokens";
import { EnvelopeEncryptionService } from "../common/crypto/envelope-encryption.service";

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.PAYMENT_RECONCILIATION }, { name: QUEUE_NAMES.RECEIPT_GENERATION }),
  ],
  providers: [
    PaymentReconciliationProcessor,
    PaymentGatewayCredentialsService,
    EnvelopeEncryptionService,
    { provide: MONNIFY_ADAPTER, useValue: new MonnifyAdapter() },
    { provide: PAYSTACK_ADAPTER, useValue: new PaystackAdapter() },
  ],
})
export class PaymentReconciliationModule {}
