import { IsNumber, IsUUID, Min } from "class-validator";

// No `method` field — this endpoint only ever records a CASH payment.
// Like a manual bank-transfer submission, it starts PENDING_APPROVAL and
// requires a Super-Admin's approval before it counts toward the invoice
// (see PaymentService.recordCash's comment). Gateway/manual-transfer
// methods arrive as their own endpoints rather than extra branches here.
export class RecordCashPaymentDto {
  @IsUUID()
  invoiceId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;
}
