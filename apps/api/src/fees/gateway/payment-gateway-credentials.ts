import { Injectable, NotFoundException } from "@nestjs/common";
import { PaymentGatewayProvider } from "@prisma/client";
import type { PaymentGatewayCredentials } from "@school/types/payment-gateways";
import { PrismaService } from "../../prisma/prisma.service";
import { EnvelopeEncryptionService } from "../../common/crypto/envelope-encryption.service";

/**
 * Loads + decrypts a provider's credentials fresh on every call — never
 * cached across requests, so a rotated credential (PaymentGatewayConfig
 * updated via the CRUD endpoint) takes effect on the very next gateway call
 * rather than waiting out some cache TTL.
 */
@Injectable()
export class PaymentGatewayCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeEncryptionService,
  ) {}

  async getCredentials(provider: PaymentGatewayProvider): Promise<PaymentGatewayCredentials> {
    const config = await this.prisma.paymentGatewayConfig.findUnique({ where: { provider } });
    if (!config) {
      throw new NotFoundException(
        `No PaymentGatewayConfig row for provider ${provider} — configure it via POST /payment-gateway-configs before checkout can use it.`,
      );
    }
    return {
      apiKey: this.envelope.decrypt(config.apiKey),
      secretKey: this.envelope.decrypt(config.secretKey),
      contractCode: config.contractCode ?? undefined,
      environment: config.environment,
    };
  }
}
