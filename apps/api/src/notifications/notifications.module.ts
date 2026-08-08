import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { NotificationController, NotificationService } from "./notification";
import { NotificationPreferenceController, NotificationPreferenceService } from "./notification-preference";
import { NotificationTemplateController, NotificationTemplateService } from "./notification-template";
import { NotificationsGateway } from "./notifications.gateway";
import { EmailWebhookController, EmailWebhookService } from "./email-webhook";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMAIL_DISPATCH })],
  controllers: [
    NotificationController,
    NotificationPreferenceController,
    NotificationTemplateController,
    EmailWebhookController,
  ],
  providers: [
    NotificationService,
    NotificationPreferenceService,
    NotificationTemplateService,
    NotificationsGateway,
    EmailWebhookService,
  ],
  // Exported for future callers (fees/assessments/identity) that need to
  // trigger a notification — not called from anywhere yet (BUILD_PLAN.md §8
  // item 3+).
  exports: [NotificationService],
})
export class NotificationsModule {}
