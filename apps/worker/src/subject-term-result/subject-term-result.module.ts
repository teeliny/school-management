import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { QUEUE_NAMES } from "@school/types";
import { SubjectTermResultService } from "./subject-term-result.service";
import { SubjectTermResultRecomputeProcessor } from "./subject-term-result-recompute.processor";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.SUBJECT_TERM_RESULT_RECOMPUTE })],
  providers: [SubjectTermResultService, SubjectTermResultRecomputeProcessor],
  exports: [SubjectTermResultService],
})
export class SubjectTermResultModule {}
