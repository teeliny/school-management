import { Injectable } from "@nestjs/common";
import { PaymentGatewayProvider } from "@prisma/client";
import type { PaymentGatewayCredentials } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { EnvelopeEncryptionService } from "../common/crypto/envelope-encryption.service";

/**
 * Duplicated from apps/api/src/fees/gateway/payment-gateway-credentials.ts
 * — apps/worker can't import apps/api's NestJS providers (separate
 * process), same cross-process boundary already established for
 * BroadsheetService's reimplementation of computeAnnualSummary.
 */
@Injectable()
export class PaymentGatewayCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeEncryptionService,
  ) {}

  async getCredentials(provider: PaymentGatewayProvider): Promise<PaymentGatewayCredentials> {
    const config = await this.prisma.paymentGatewayConfig.findUniqueOrThrow({ where: { provider } });
    return {
      apiKey: this.envelope.decrypt(config.apiKey),
      secretKey: this.envelope.decrypt(config.secretKey),
      contractCode: config.contractCode ?? undefined,
      environment: config.environment,
    };
  }
}
