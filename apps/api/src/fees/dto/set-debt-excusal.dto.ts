import { IsBoolean, IsOptional, IsString } from "class-validator";

export class SetDebtExcusalDto {
  @IsBoolean()
  isExcused!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
