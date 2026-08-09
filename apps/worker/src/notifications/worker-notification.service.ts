import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { NotificationType } from "@prisma/client";
import type { Queue } from "bullmq";
import { EmailDispatchJob, interpolate, QUEUE_NAMES } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * A deliberate, documented duplication of apps/api's NotificationService —
 * NotificationService lives in apps/api, which apps/worker can't import
 * across the process boundary (same "duplicated per-process, not shared"
 * precedent as PaymentService.resolveGatewayOutcome/parseCorsOrigins). Only
 * worker-originated triggers (currently: the invoice-overdue sweep) use
 * this; every HTTP-request-triggered notify() still goes through the real
 * NotificationService in apps/api.
 *
 * Deliberately omits the live WebSocket push — there's no gateway in the
 * worker process. An in-app Notification row created here appears on the
 * recipient's next GET /notifications poll or socket reconnect, not
 * instantly. Accepted limitation, not silently dropped.
 */
@Injectable()
export class WorkerNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.EMAIL_DISPATCH) private readonly emailQueue: Queue<EmailDispatchJob>,
  ) {}

  async notify(recipientUserId: string, type: NotificationType, vars: Record<string, string | number> = {}): Promise<void> {
    const template = await this.prisma.notificationTemplate.findUniqueOrThrow({ where: { key: type } });

    const preference = template.isCritical
      ? null
      : await this.prisma.notificationPreference.findUnique({
          where: { userId_notificationType: { userId: recipientUserId, notificationType: type } },
        });

    const title = interpolate(template.subject, vars);
    const body = interpolate(template.bodyTemplate, vars);

    if (template.channel !== "EMAIL" && preference?.inAppEnabled !== false) {
      await this.prisma.notification.create({
        data: { recipientUserId, type, title, body },
      });
    }

    if (template.channel !== "IN_APP" && preference?.emailEnabled !== false) {
      const recipient = await this.prisma.user.findUniqueOrThrow({ where: { id: recipientUserId } });
      const emailLog = await this.prisma.emailLog.create({
        data: { recipientEmail: recipient.email, templateKey: type, status: "QUEUED" },
      });
      await this.emailQueue.add(
        "send",
        { emailLogId: emailLog.id, recipientEmail: recipient.email, subject: title, body },
        { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
      );
    }
  }
}
