import { NotificationChannel } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class UpdateNotificationTemplateDto {
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() bodyTemplate?: string;
  @IsOptional() @IsEnum(NotificationChannel) channel?: NotificationChannel;
}
