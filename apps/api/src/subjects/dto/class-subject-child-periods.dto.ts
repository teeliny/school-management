import { IsInt, Min } from "class-validator";

export class SetChildPeriodsDto {
  @IsInt()
  @Min(1)
  periodsPerWeek!: number;
}
