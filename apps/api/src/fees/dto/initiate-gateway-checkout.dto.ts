import { IsUUID } from "class-validator";

export class InitiateGatewayCheckoutDto {
  @IsUUID()
  invoiceId!: string;
}
