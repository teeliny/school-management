import { DiscountRequestType } from "@prisma/client";
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator";

// Edit of a still-PENDING request (DiscountRequestService.update). Every
// field optional — only what's sent changes. The >100 percentage cap is
// re-checked in the service against the effective (merged) type/value.
export class UpdateDiscountRequestDto {
  @IsOptional()
  @IsEnum(DiscountRequestType)
  type?: DiscountRequestType;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  value?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;
}
