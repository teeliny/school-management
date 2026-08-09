import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import { PaymentGatewayProvider } from "@prisma/client";
import {
  MONNIFY_SIGNATURE_HEADER,
  PAYSTACK_SIGNATURE_HEADER,
  type PaymentGatewayAdapter,
} from "@school/types/payment-gateways";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentService } from "./payment";
import { PaymentGatewayCredentialsService } from "./gateway/payment-gateway-credentials";
import {
  MONNIFY_ADAPTER,
  PAYSTACK_ADAPTER,
} from "./gateway/payment-gateway.tokens";
import { Audited } from "../audit/audited.decorator";

// Minimal request shape (avoids depending on @types/express, not otherwise
// a dependency of this app) — just what a webhook handler actually reads.
interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * A separate, unguarded controller — deliberately not a method on
 * PaymentController (whose whole class carries `@UseGuards(JwtAuthGuard,
 * PoliciesGuard)`). A gateway webhook can't send a JWT; it authenticates via
 * HMAC signature verification instead (same "Public: ..." precedent as
 * InvitationsController.peek/accept).
 */
@Controller("payment-gateways/webhooks")
export class PaymentGatewayWebhookController {
  private readonly logger = new Logger(PaymentGatewayWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
    private readonly credentials: PaymentGatewayCredentialsService,
    @Inject(MONNIFY_ADAPTER) private readonly monnify: PaymentGatewayAdapter,
    @Inject(PAYSTACK_ADAPTER) private readonly paystack: PaymentGatewayAdapter,
  ) {}

  /** Public: Monnify cannot send a JWT — authenticated via monnify-signature HMAC verification instead. No `request.user`, so actorUserId comes out null — correct, a gateway webhook has no human actor. No `:id` param (resolved internally via `parsed.reference`), so no model given either. */
  @Post("monnify")
  @HttpCode(HttpStatus.OK)
  @Audited("Payment")
  async handleMonnifyWebhook(@Req() req: RawBodyRequest<WebhookRequest>) {
    return this.handle(
      PaymentGatewayProvider.MONNIFY,
      this.monnify,
      req,
      MONNIFY_SIGNATURE_HEADER,
    );
  }

  /** Public: Paystack cannot send a JWT — authenticated via x-paystack-signature HMAC verification instead. Same actorUserId=null/no-model reasoning as handleMonnifyWebhook. */
  @Post("paystack")
  @HttpCode(HttpStatus.OK)
  @Audited("Payment")
  async handlePaystackWebhook(@Req() req: RawBodyRequest<WebhookRequest>) {
    return this.handle(
      PaymentGatewayProvider.PAYSTACK,
      this.paystack,
      req,
      PAYSTACK_SIGNATURE_HEADER,
    );
  }

  private async handle(
    provider: PaymentGatewayProvider,
    adapter: PaymentGatewayAdapter,
    req: RawBodyRequest<WebhookRequest>,
    signatureHeaderName: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException("Missing raw request body");
    }

    const signatureHeader = req.headers[signatureHeaderName];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;

    const credentials = await this.credentials.getCredentials(provider);
    if (!adapter.verifyWebhookSignature(credentials, rawBody, signature)) {
      this.logger.warn(`Rejected ${provider} webhook: invalid signature`);
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const parsed = adapter.parseWebhookPayload(rawBody);
    if (!parsed) {
      this.logger.warn(`Rejected ${provider} webhook: unparseable payload`);
      return { received: true };
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { gatewayPaymentReference: parsed.reference },
    });
    if (!invoice) {
      this.logger.warn(
        `Rejected ${provider} webhook: no invoice for reference ${parsed.reference}`,
      );
      return { received: true };
    }

    await this.paymentService.resolveGatewayOutcome(
      invoice.id,
      provider,
      parsed,
    );
    return { received: true };
  }
}
