import { IsNotEmpty, IsString } from "class-validator";

export class RejectDiscountRequestDto {
  @IsString()
  @IsNotEmpty()
  rejectionReason!: string;
}
