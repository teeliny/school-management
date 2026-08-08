import { PartialType } from "@nestjs/mapped-types";
import { PaymentGatewayEnvironment, PaymentGatewayProvider } from "@prisma/client";
import { IsBoolean, IsEnum, IsOptional, IsString } from "class-validator";

export class CreatePaymentGatewayConfigDto {
  @IsEnum(PaymentGatewayProvider)
  provider!: PaymentGatewayProvider;

  @IsString()
  apiKey!: string;

  @IsString()
  secretKey!: string;

  @IsOptional()
  @IsString()
  contractCode?: string;

  @IsOptional()
  @IsBoolean()
  reservedAccountEnabled?: boolean;

  @IsOptional()
  @IsEnum(PaymentGatewayEnvironment)
  environment?: PaymentGatewayEnvironment;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePaymentGatewayConfigDto extends PartialType(CreatePaymentGatewayConfigDto) {}
