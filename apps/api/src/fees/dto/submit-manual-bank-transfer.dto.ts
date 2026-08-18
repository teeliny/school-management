import { Type } from "class-transformer";
import { IsNumber, IsUUID, Min } from "class-validator";

// Arrives as multipart/form-data alongside a `file` field (the
// proof-of-payment image/PDF) — every field is a string on the wire, hence
// @Type(() => Number) on amount, same as any other form-encoded numeric.
export class SubmitManualBankTransferDto {
  @IsUUID()
  invoiceId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;
}
