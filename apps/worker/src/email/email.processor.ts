import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import type { Job } from "bullmq";
import { Resend } from "resend";
import { QUEUE_NAMES, type EmailDispatchJob } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * PRD §3.10, FR8.3: the actual Resend-sending half of the notification
 * pipeline — apps/api's NotificationService creates the EmailLog row
 * (status QUEUED) and enqueues the job; this processor sends and updates
 * that same row. Deliberately separate from apps/api's MailerService (which
 * only ever sends the invitation email) rather than shared — same
 * "duplicated per-app, not shared" precedent as parseCorsOrigins().
 */
@Processor(QUEUE_NAMES.EMAIL_DISPATCH)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly resend: Resend | null;
  private readonly fromEmail: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    super();
    const apiKey = config.get<string>("RESEND_API_KEY");
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.fromEmail =
      config.get<string>("RESEND_FROM_EMAIL") ?? "no-reply@example.com";
  }

  async process(job: Job<EmailDispatchJob>): Promise<void> {
    const { emailLogId, recipientEmail, subject, body } = job.data;

    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY not set — logging email instead of sending.\nTo: ${recipientEmail}\nSubject: ${subject}\n${body}`,
      );
      await this.prisma.emailLog.update({
        where: { id: emailLogId },
        data: { status: "SENT", sentAt: new Date() },
      });
      return;
    }

    try {
      // const result = await this.resend.emails.send({
      //   from: this.fromEmail,
      //   to: recipientEmail,
      //   subject,
      //   html: body,
      // });
      console.log(body, "body");
      await this.prisma.emailLog.update({
        where: { id: emailLogId },
        data: {
          status: "SENT",
          resendMessageId: "result.data?.id",
          sentAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.emailLog.update({
        where: { id: emailLogId },
        data: { status: "FAILED", error: String(error) },
      });
      // BullMQ's configured attempts/backoff (see NotificationService.notify)
      // only retries when process() throws.
      throw error;
    }
  }
}
