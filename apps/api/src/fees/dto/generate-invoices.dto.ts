import { Type } from "class-transformer";
import { IsDate, IsOptional, IsUUID } from "class-validator";

export class GenerateInvoicesDto {
  @IsUUID()
  termId!: string;

  // Omitted = whole school; set = only students in this class level.
  @IsOptional()
  @IsUUID()
  classLevelId?: string;

  @Type(() => Date)
  @IsDate()
  dueDate!: Date;
}
