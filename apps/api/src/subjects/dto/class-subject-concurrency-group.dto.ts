import { ClassLevelCategory } from "@prisma/client";
import { IsEnum, IsString, MinLength } from "class-validator";

export class CreateClassSubjectConcurrencyGroupDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(ClassLevelCategory)
  classLevelCategory!: ClassLevelCategory;
}
