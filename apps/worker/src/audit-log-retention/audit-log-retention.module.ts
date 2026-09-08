import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { AuditLogRetentionProcessor } from "./audit-log-retention.processor";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.AUDIT_LOG_RETENTION })],
  providers: [AuditLogRetentionProcessor],
})
export class AuditLogRetentionModule {}
