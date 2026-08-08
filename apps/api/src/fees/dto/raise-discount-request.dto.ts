import { DiscountRequestType } from "@prisma/client";
import { IsEnum, IsNotEmpty, IsNumber, IsString, IsUUID, Min } from "class-validator";

export class RaiseDiscountRequestDto {
  @IsUUID()
  invoiceId!: string;

  @IsEnum(DiscountRequestType)
  type!: DiscountRequestType;

  // A 0-100 percentage when type is PERCENTAGE, a raw currency amount when
  // FIXED_AMOUNT — the >100 percentage cap is enforced in the service,
  // since it depends on `type`.
  @IsNumber()
  @Min(0.01)
  value!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
