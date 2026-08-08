import {
  Controller,
  HttpCode,
  HttpStatus,
  Injectable,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Webhook } from "svix";
import { EmailLogStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

// Minimal request shape (avoids depending on @types/express, not otherwise a
// dependency of this app) — same precedent as payment-gateway-webhook.ts.
interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface ResendWebhookEvent {
  type: string;
  data: {
    email_id: string;
    // Exact shape of bounce/complaint detail fields isn't pinned down
    // against a live Resend payload yet — read defensively.
    bounce?: { message?: string };
  };
}

const EVENT_STATUS_MAP: Record<string, EmailLogStatus> = {
  "email.sent": EmailLogStatus.SENT,
  "email.delivered": EmailLogStatus.DELIVERED,
  "email.bounced": EmailLogStatus.BOUNCED,
  "email.complained": EmailLogStatus.COMPLAINED,
};

/**
 * FR8.4: Resend delivery webhooks update EmailLog.status; a bounce/
 * complaint flags the recipient's ParentProfile for Admin follow-up
 * (surfaced for free via the existing GET /parent-profiles list — no new
 * read endpoint needed).
 */
@Injectable()
export class EmailWebhookService {
  private readonly logger = new Logger(EmailWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  verify(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ResendWebhookEvent {
    const secret = this.config.getOrThrow<string>("RESEND_WEBHOOK_SECRET");
    const svixHeaders = {
      "svix-id": this.headerValue(headers["svix-id"]),
      "svix-timestamp": this.headerValue(headers["svix-timestamp"]),
      "svix-signature": this.headerValue(headers["svix-signature"]),
    };

    try {
      return new Webhook(secret).verify(rawBody, svixHeaders) as ResendWebhookEvent;
    } catch {
      throw new UnauthorizedException("Invalid webhook signature");
    }
  }

  async handleEvent(event: ResendWebhookEvent): Promise<void> {
    const status = EVENT_STATUS_MAP[event.type];
    if (!status) return;

    const emailLog = await this.prisma.emailLog.findUnique({ where: { resendMessageId: event.data.email_id } });
    if (!emailLog) {
      this.logger.warn(`No EmailLog for resendMessageId ${event.data.email_id}`);
      return;
    }

    const isFailure = status === EmailLogStatus.BOUNCED || status === EmailLogStatus.COMPLAINED;
    await this.prisma.emailLog.update({
      where: { id: emailLog.id },
      data: { status, error: isFailure ? (event.data.bounce?.message ?? null) : undefined },
    });

    if (isFailure) {
      await this.flagGuardian(emailLog.recipientEmail);
    }
  }

  private headerValue(value: string | string[] | undefined): string {
    return (Array.isArray(value) ? value[0] : value) ?? "";
  }

  // FR8.4 names the guardian record specifically — a bounce on a
  // staff/admin email is tracked in EmailLog.status alone, no profile to flag.
  private async flagGuardian(recipientEmail: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: recipientEmail },
      include: { parentProfile: true },
    });
    if (!user?.parentProfile) return;

    await this.prisma.parentProfile.update({
      where: { id: user.parentProfile.id },
      data: { emailBounced: true, emailBouncedAt: new Date() },
    });
  }
}

/**
 * A separate, unguarded controller — Resend can't send a JWT, it
 * authenticates via svix signature verification instead (same "Public: ..."
 * precedent as PaymentGatewayWebhookController).
 */
@Controller("email-webhooks")
export class EmailWebhookController {
  constructor(private readonly service: EmailWebhookService) {}

  /** Public: Resend cannot send a JWT — authenticated via svix signature verification instead. */
  @Post("resend")
  @HttpCode(HttpStatus.OK)
  async handle(@Req() req: RawBodyRequest<WebhookRequest>) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException("Missing raw request body");
    }

    const event = this.service.verify(rawBody, req.headers);
    await this.service.handleEvent(event);
    return { received: true };
  }
}
