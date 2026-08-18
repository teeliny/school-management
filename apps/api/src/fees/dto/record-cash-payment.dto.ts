import { IsNumber, IsUUID, Min } from "class-validator";

// No `method` field — this endpoint only ever records a CASH payment in
// this slice (PRD §3.9: "Bursar can additionally record manual CASH
// payments... which take effect immediately"). Gateway/manual-transfer
// methods arrive as their own endpoints in later slices rather than extra
// branches here.
export class RecordCashPaymentDto {
  @IsUUID()
  invoiceId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}
