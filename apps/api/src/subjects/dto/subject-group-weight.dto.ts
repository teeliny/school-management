import { PartialType } from "@nestjs/mapped-types";
import { IsNumber, IsUUID } from "class-validator";

export class CreateSubjectGroupWeightDto {
  @IsUUID()
  groupSubjectId!: string;

  @IsUUID()
  childSubjectId!: string;

  @IsNumber()
  weight!: number;
}

export class UpdateSubjectGroupWeightDto extends PartialType(CreateSubjectGroupWeightDto) {}
