import { Type } from "class-transformer";
import { IsDate, IsOptional, IsUUID } from "class-validator";

export class AssignStudentToFeeStructureDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  feeStructureId!: string;

  // Only used if this assignment immediately triggers a SUPPLEMENTARY
  // invoice (a REGULAR invoice for the term already exists) — defaults to
  // that REGULAR invoice's own dueDate otherwise.
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;
}
