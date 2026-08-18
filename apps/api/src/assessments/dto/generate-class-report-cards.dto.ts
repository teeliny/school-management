import { IsUUID } from "class-validator";

export class GenerateClassReportCardsDto {
  @IsUUID()
  classArmId!: string;

  @IsUUID()
  termId!: string;
}
