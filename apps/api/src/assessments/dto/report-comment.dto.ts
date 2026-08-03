import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";
import { ReportCommentType } from "@prisma/client";

export class CreateReportCommentDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  termId!: string;

  @IsEnum(ReportCommentType)
  commentType!: ReportCommentType;

  // Required (and only valid) when commentType = SUBJECT — validated in
  // ReportCommentService, not here, since it depends on another field.
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsString()
  @IsNotEmpty()
  comment!: string;
}
