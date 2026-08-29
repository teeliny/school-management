import { ArrayMinSize, IsArray, IsNotEmpty, IsString, IsUUID } from "class-validator";

export class BulkWaiveFeeDto {
  @IsUUID()
  feeStructureId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  studentIds!: string[];

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
