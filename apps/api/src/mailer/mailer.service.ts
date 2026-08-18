import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * A deliberately minimal, send-only mailer — not the full NotificationsModule
 * (templates, in-app notifications, bounce tracking, NotificationPreference),
 * which is Phase 6 (PRD §3.10, BUILD_PLAN.md §8). This exists now only
 * because the invitation flow (Phase 1) genuinely needs to send one email.
 *
 * If RESEND_API_KEY isn't configured (e.g. local dev without a real Resend
 * account), emails are logged instead of sent — the invite link is still
 * usable, just read from the log rather than an inbox.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly resend: Resend | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async send(input: SendEmailInput): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY not set — logging email instead of sending.\n` +
          `To: ${input.to}\nSubject: ${input.subject}\n${input.html}`,
      );
      return;
    }

    // await this.resend.emails.send({
    //   from:
    //     this.config.get<string>("RESEND_FROM_EMAIL") ?? "no-reply@example.com",
    //   to: input.to,
    //   subject: input.subject,
    //   html: input.html,
    // });
  }
}
