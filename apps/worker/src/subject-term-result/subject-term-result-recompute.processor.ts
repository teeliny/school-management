import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { QUEUE_NAMES, type SubjectTermResultRecomputeJob } from "@school/types";
import { SubjectTermResultService } from "./subject-term-result.service";

/**
 * Consumes the job StudentSubjectEnrollmentService.enroll fires on explicit
 * opt-in (apps/api) — see SubjectTermResultService.recomputeForStudentSubjectTerm
 * for why this exists as its own scoped queue rather than reusing
 * ASSESSMENT_SCHEDULE_SWEEP (that queue's processor is purpose-built for its
 * own repeatable cron job, not a one-off per-opt-in payload).
 */
@Processor(QUEUE_NAMES.SUBJECT_TERM_RESULT_RECOMPUTE)
export class SubjectTermResultRecomputeProcessor extends WorkerHost {
  private readonly logger = new Logger(SubjectTermResultRecomputeProcessor.name);

  constructor(private readonly subjectTermResults: SubjectTermResultService) {
    super();
  }

  async process(job: Job<SubjectTermResultRecomputeJob>): Promise<void> {
    await this.subjectTermResults.recomputeForStudentSubjectTerm(job.data);
    this.logger.log(
      `Recomputed SubjectTermResult for student ${job.data.studentId}, subject ${job.data.subjectId}, term ${job.data.termId}`,
    );
  }
}
