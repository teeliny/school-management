import { Body, Controller, Get, Injectable, Param, Patch, UseGuards } from "@nestjs/common";
import { NotificationType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { UpdateNotificationTemplateDto } from "./dto/notification-template.dto";

/**
 * PRD §3.10: Admin can customize this school's shipped default copy.
 * `isCustomized` flips true on first edit — same "shipped default, later
 * customized" shape as other configuration in this codebase.
 */
@Injectable()
export class NotificationTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.notificationTemplate.findMany({ orderBy: { key: "asc" } });
  }

  update(key: NotificationType, dto: UpdateNotificationTemplateDto) {
    return this.prisma.notificationTemplate.update({
      where: { key },
      data: { ...dto, isCustomized: true },
    });
  }
}

@Controller("notification-templates")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class NotificationTemplateController {
  constructor(private readonly service: NotificationTemplateService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Patch(":key")
  @CheckPolicies((ability) => ability.can("manage", "NotificationTemplate"))
  update(@Param("key") key: NotificationType, @Body() dto: UpdateNotificationTemplateDto) {
    return this.service.update(key, dto);
  }
}
