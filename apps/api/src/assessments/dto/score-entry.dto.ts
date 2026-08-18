import { IsNumber, IsUUID, Min } from "class-validator";

export class CreateScoreEntryDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  assessmentComponentId!: string;

  @IsUUID()
  classArmId!: string;

  @IsNumber()
  @Min(0)
  score!: number;
}
