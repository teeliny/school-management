import { PartialType } from "@nestjs/mapped-types";
import { ClassLevelCategory } from "@prisma/client";
import { IsEnum, IsInt, IsString } from "class-validator";

export class CreateClassLevelDto {
  @IsString() name!: string;
  @IsInt() order!: number;
  @IsEnum(ClassLevelCategory) category!: ClassLevelCategory;
}

export class UpdateClassLevelDto extends PartialType(CreateClassLevelDto) {}
