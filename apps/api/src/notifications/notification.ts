import { Controller, ForbiddenException, Get, Injectable, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Notification, NotificationType } from "@prisma/client";
import type { Queue } from "bullmq";
import { EmailDispatchJob, QUEUE_NAMES } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { NotificationsGateway } from "./notifications.gateway";

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(vars[key] ?? ""));
}

/**
 * PRD §3.10, FR8.1–FR8.6: the generic notify/deliver mechanism — every
 * NotificationType has exactly one NotificationTemplate (enforced by
 * `key`/`type` sharing the same enum), so `notify` can never be called with
 * a type that has no copy to render. Not yet called from anywhere else in
 * the codebase (see BUILD_PLAN.md §8 item 3+) — exported from
 * NotificationsModule for future callers to inject.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    @InjectQueue(QUEUE_NAMES.EMAIL_DISPATCH) private readonly emailQueue: Queue<EmailDispatchJob>,
  ) {}

  async notify(
    recipientUserId: string,
    type: NotificationType,
    vars: Record<string, string | number> = {},
  ): Promise<Notification | null> {
    const template = await this.prisma.notificationTemplate.findUniqueOrThrow({ where: { key: type } });

    // FR8.6: critical types ignore NotificationPreference entirely — only a
    // non-critical type can be suppressed, and only by an explicit opt-out
    // (a missing preference row means the default, enabled). Each channel
    // has its own opt-out, checked independently below.
    const preference = template.isCritical
      ? null
      : await this.prisma.notificationPreference.findUnique({
          where: { userId_notificationType: { userId: recipientUserId, notificationType: type } },
        });

    const title = interpolate(template.subject, vars);
    const body = interpolate(template.bodyTemplate, vars);

    let notification: Notification | null = null;
    if (template.channel !== "EMAIL" && preference?.inAppEnabled !== false) {
      notification = await this.prisma.notification.create({
        data: { recipientUserId, type, title, body },
      });
      this.gateway.emitToUser(recipientUserId, "notification:new", notification);
      this.gateway.emitToUser(recipientUserId, "notification:unread-count", await this.unreadCount(recipientUserId));
    }

    if (template.channel !== "IN_APP" && preference?.emailEnabled !== false) {
      const recipient = await this.prisma.user.findUniqueOrThrow({ where: { id: recipientUserId } });
      const emailLog = await this.prisma.emailLog.create({
        data: { recipientEmail: recipient.email, templateKey: type, status: "QUEUED" },
      });
      await this.emailQueue.add(
        "send",
        { emailLogId: emailLog.id, recipientEmail: recipient.email, subject: title, body },
        { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
      );
    }

    return notification;
  }

  findMine(userId: string, options: { unreadOnly?: boolean; skip?: number; take?: number } = {}) {
    return this.prisma.notification.findMany({
      where: { recipientUserId: userId, ...(options.unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: "desc" },
      skip: options.skip,
      take: options.take,
    });
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { recipientUserId: userId, isRead: false } });
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const existing = await this.prisma.notification.findUniqueOrThrow({ where: { id } });
    if (existing.recipientUserId !== userId) {
      throw new ForbiddenException("Not your notification");
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    this.gateway.emitToUser(userId, "notification:unread-count", await this.unreadCount(userId));
    return updated;
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    this.gateway.emitToUser(userId, "notification:unread-count", 0);
  }
}

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  findMine(
    @CurrentUser() user: RequestUser,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.service.findMine(user.id, {
      unreadOnly: unreadOnly === "true",
      skip: skip === undefined ? undefined : Number(skip),
      take: take === undefined ? undefined : Number(take),
    });
  }

  @Get("unread-count")
  unreadCount(@CurrentUser() user: RequestUser) {
    return this.service.unreadCount(user.id);
  }

  @Patch(":id/read")
  markRead(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.service.markRead(user.id, id);
  }

  @Patch("read-all")
  markAllRead(@CurrentUser() user: RequestUser) {
    return this.service.markAllRead(user.id);
  }
}
