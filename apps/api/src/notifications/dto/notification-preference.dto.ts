import { IsBoolean, IsOptional } from "class-validator";

export class UpdateNotificationPreferenceDto {
  @IsOptional() @IsBoolean() inAppEnabled?: boolean;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
}
