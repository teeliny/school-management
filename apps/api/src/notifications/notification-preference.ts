import { Body, Controller, ForbiddenException, Get, Injectable, Param, Patch, UseGuards } from "@nestjs/common";
import { NotificationType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { UpdateNotificationPreferenceDto } from "./dto/notification-preference.dto";

export interface EffectiveNotificationPreference {
  notificationType: NotificationType;
  isCritical: boolean;
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

/**
 * PRD §3.10, FR8.5/FR8.6: a missing NotificationPreference row means "still
 * on the default" (both channels enabled) — rows only get written when a
 * user actually opts out of a non-critical type.
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(userId: string): Promise<EffectiveNotificationPreference[]> {
    const [templates, preferences] = await Promise.all([
      this.prisma.notificationTemplate.findMany({ orderBy: { key: "asc" } }),
      this.prisma.notificationPreference.findMany({ where: { userId } }),
    ]);
    const byType = new Map(preferences.map((preference) => [preference.notificationType, preference]));

    return templates.map((template) => {
      const preference = byType.get(template.key);
      return {
        notificationType: template.key,
        isCritical: template.isCritical,
        inAppEnabled: preference?.inAppEnabled ?? true,
        emailEnabled: preference?.emailEnabled ?? true,
      };
    });
  }

  async update(userId: string, notificationType: NotificationType, dto: UpdateNotificationPreferenceDto) {
    const template = await this.prisma.notificationTemplate.findUniqueOrThrow({ where: { key: notificationType } });
    if (template.isCritical) {
      throw new ForbiddenException("This notification type cannot be disabled");
    }

    return this.prisma.notificationPreference.upsert({
      where: { userId_notificationType: { userId, notificationType } },
      create: { userId, notificationType, ...dto },
      update: dto,
    });
  }
}

@Controller("notification-preferences")
@UseGuards(JwtAuthGuard)
export class NotificationPreferenceController {
  constructor(private readonly service: NotificationPreferenceService) {}

  @Get()
  findMine(@CurrentUser() user: RequestUser) {
    return this.service.findMine(user.id);
  }

  @Patch(":type")
  update(
    @Param("type") type: NotificationType,
    @Body() dto: UpdateNotificationPreferenceDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.update(user.id, type, dto);
  }
}
