import { Module } from "@nestjs/common";
import { SubjectTermResultService } from "./subject-term-result.service";

@Module({
  providers: [SubjectTermResultService],
  exports: [SubjectTermResultService],
})
export class SubjectTermResultModule {}
