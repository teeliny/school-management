import { IsNotEmpty, IsString } from "class-validator";

export class RejectScheduleRowDto {
  @IsString()
  @IsNotEmpty()
  rejectionReason!: string;
}
