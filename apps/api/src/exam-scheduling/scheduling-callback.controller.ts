import { Body, Controller, Param, Post, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { ScheduleGenerationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification";

interface SchedulingCallbackBody {
  callbackToken: string;
  result?: { generatedRows?: unknown[] };
  error?: string;
}

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard that first, same shape as PaymentGatewayAdapter's HMAC compare.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * ARCHITECTURE.md §9: the solver calls back here when it finishes. Public —
 * no JWT guard — the scheduling-engine authenticates via the per-request
 * `callbackToken` instead (same "Public: ..." precedent as the payment
 * gateway webhook controller). Step 1 does not yet persist any generated
 * rows on success (no ExamSchedule/InvigilationAssignment/DutyAssignment
 * model exists, and TimetableSlot persistence arrives with the real
 * CLASS_TIMETABLE solver in BUILD_PLAN.md §9 Step 2) — it only verifies the
 * token and flips status, proving the round trip.
 */
@Controller("internal/scheduling-callback")
export class SchedulingCallbackController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Post(":requestId")
  async handle(@Param("requestId") requestId: string, @Body() body: SchedulingCallbackBody) {
    const request = await this.prisma.scheduleGenerationRequest.findUnique({ where: { id: requestId } });
    if (!request || !tokensMatch(body.callbackToken ?? "", request.callbackToken)) {
      throw new UnauthorizedException("Invalid callback token");
    }

    if (body.error) {
      await this.prisma.scheduleGenerationRequest.update({
        where: { id: requestId },
        data: { status: ScheduleGenerationStatus.FAILED, errorMessage: body.error, completedAt: new Date() },
      });
      await this.notifications.notify(request.requestedByUserId, "SCHEDULE_GENERATION_FAILED", {
        scope: request.scope,
        errorMessage: body.error,
      });
      return { received: true };
    }

    await this.prisma.scheduleGenerationRequest.update({
      where: { id: requestId },
      data: { status: ScheduleGenerationStatus.COMPLETED, completedAt: new Date() },
    });
    await this.notifications.notify(request.requestedByUserId, "SCHEDULE_GENERATION_COMPLETED", {
      scope: request.scope,
    });
    return { received: true };
  }
}
