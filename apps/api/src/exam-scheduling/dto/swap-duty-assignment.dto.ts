import { IsUUID } from "class-validator";

export class SwapDutyAssignmentDto {
  @IsUUID()
  withId!: string;
}
