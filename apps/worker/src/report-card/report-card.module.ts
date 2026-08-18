import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { ReportCardProcessor } from "./report-card.processor";
import { SubjectTermResultModule } from "../subject-term-result/subject-term-result.module";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.REPORT_CARD_GENERATION }), SubjectTermResultModule],
  providers: [ReportCardProcessor],
})
export class ReportCardModule {}
