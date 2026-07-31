import { PartialType } from "@nestjs/mapped-types";
import { IsInt, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateClassArmDto {
  @IsUUID() classLevelId!: string;
  @IsUUID() academicSessionId!: string;
  @IsString() name!: string;
  @IsOptional() @IsInt() capacity?: number;
}

export class UpdateClassArmDto extends PartialType(CreateClassArmDto) {}
