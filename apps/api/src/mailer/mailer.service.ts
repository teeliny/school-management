import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import { formatFromAddress, renderEmailHtml, renderEmailText } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Pre-built HTML body content (e.g. from `textToBodyHtml`) — gets wrapped in the shared branded shell, not sent as the whole document. */
  html: string;
  /** Defaults to `subject` — set this when the inbox subject line should differ from the on-page heading. */
  heading?: string;
  ctaLabel?: string;
  ctaUrl?: string;
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

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  private async render(input: SendEmailInput): Promise<{ html: string; text: string; schoolName: string }> {
    const school = await this.prisma.schoolProfile.findFirst();
    const params = {
      schoolName: school?.name ?? "Your School",
      logoUrl: school?.logoUrl,
      heading: input.heading ?? input.subject,
      bodyHtml: input.html,
      ctaLabel: input.ctaLabel,
      ctaUrl: input.ctaUrl,
      footerNote: school?.contactEmail ? `Questions? Contact ${school.contactEmail}.` : undefined,
    };
    return { html: renderEmailHtml(params), text: renderEmailText(params), schoolName: params.schoolName };
  }

  async send(input: SendEmailInput): Promise<void> {
    const { html, text, schoolName } = await this.render(input);
    const fromEmail =
      this.config.get<string>("RESEND_FROM_EMAIL") ?? "no-reply@example.com";
    const from = formatFromAddress(schoolName, fromEmail);

    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY not set — logging email instead of sending.\n` +
          `To: ${input.to}\nSubject: ${input.subject}\n${html}`,
      );
      return;
    }

    await this.resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html,
      text,
    });
  }
}
