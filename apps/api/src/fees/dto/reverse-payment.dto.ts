import { IsNotEmpty, IsString } from "class-validator";

export class ReversePaymentDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
