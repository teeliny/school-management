import { IsUUID } from "class-validator";

export class SwapInvigilationAssignmentDto {
  @IsUUID()
  withId!: string;
}
