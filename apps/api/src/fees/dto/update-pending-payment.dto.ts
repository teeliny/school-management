import { Type } from "class-transformer";
import { IsNumber, IsOptional, Min } from "class-validator";

// Edit of a still-PENDING_APPROVAL CASH/BANK_TRANSFER_MANUAL payment
// (PaymentService.updatePending). Arrives as multipart/form-data (an optional
// replacement proof `file` for a manual transfer), so amount is a string on
// the wire — hence @Type(() => Number), same as SubmitManualBankTransferDto.
export class UpdatePendingPaymentDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;
}
