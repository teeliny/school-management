import { TermReportCardType } from "@prisma/client";
import { IsEnum, IsOptional, IsUUID } from "class-validator";

/**
 * Scope for TermReportCardService.publishAll — mirrors the Report Cards
 * list's own filters so "Publish all" acts on exactly what the Admin is
 * looking at. termId is required so one click can never sweep across terms.
 */
export class PublishAllReportCardsDto {
  @IsUUID()
  termId!: string;

  @IsOptional()
  @IsEnum(TermReportCardType)
  reportType?: TermReportCardType;

  @IsOptional()
  @IsUUID()
  classArmId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
