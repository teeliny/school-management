import { IsUUID } from "class-validator";

export class GenerateTermReportCardDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  termId!: string;
}
