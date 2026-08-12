import { Body, Controller, Logger, Param, Post, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { DayOfWeek, ScheduleGenerationStatus, ScheduleScope, TimetableApprovalStatus, TimetableGeneratedBy } from "@prisma/client";
import { DAYS_OF_WEEK } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification";
import { TimetableSlotService } from "../timetable/timetable-slot";

interface ClassTimetableGeneratedRow {
  classArmId: string;
  subjectId: string;
  staffId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
}

interface SchedulingCallbackBody {
  callbackToken: string;
  result?: { generatedRows?: ClassTimetableGeneratedRow[] };
  error?: string;
}

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard that first, same shape as PaymentGatewayAdapter's HMAC compare.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function isDayOfWeek(value: string): value is DayOfWeek {
  return (DAYS_OF_WEEK as string[]).includes(value);
}

/**
 * ARCHITECTURE.md §9: the solver calls back here when it finishes. Public —
 * no JWT guard — the scheduling-engine authenticates via the per-request
 * `callbackToken` instead (same "Public: ..." precedent as the payment
 * gateway webhook controller).
 */
@Controller("internal/scheduling-callback")
export class SchedulingCallbackController {
  private readonly logger = new Logger(SchedulingCallbackController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly timetableSlots: TimetableSlotService,
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

    if (request.scope === ScheduleScope.CLASS_TIMETABLE) {
      await this.persistClassTimetableRows(request.termId, body.result?.generatedRows ?? []);
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

  /**
   * BUILD_PLAN.md §9 Step 2: persists the solver's result as `TimetableSlot`
   * rows (`generatedBy=AI, approvalStatus=PENDING_REVIEW` — not visible to
   * staff/students/parents until an Admin/Super-Admin approves, FR6.5).
   * Reuses `TimetableSlotService.assertNoConflicts` per row as a final
   * safety net on top of the solver's own conflict avoidance, inside a
   * single transaction so each check sees the batch's own prior inserts —
   * belt-and-suspenders, not the primary defense (that's the CP-SAT model
   * itself).
   */
  private async persistClassTimetableRows(termId: string | null, rows: ClassTimetableGeneratedRow[]) {
    if (!termId) {
      this.logger.warn("CLASS_TIMETABLE callback with no termId on the request — nothing to persist");
      return;
    }
    if (rows.length === 0) return;

    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        if (!isDayOfWeek(row.dayOfWeek)) {
          this.logger.warn(`Dropping generated row with unrecognized dayOfWeek "${row.dayOfWeek}"`);
          continue;
        }

        await this.timetableSlots.assertNoConflicts(
          {
            staffId: row.staffId,
            venue: null,
            dayOfWeek: row.dayOfWeek,
            academicSessionId: term.academicSessionId,
            termId,
            startTime: row.startTime,
            endTime: row.endTime,
          },
          undefined,
          tx,
        );

        await tx.timetableSlot.create({
          data: {
            classArmId: row.classArmId,
            subjectId: row.subjectId,
            staffId: row.staffId,
            academicSessionId: term.academicSessionId,
            termId,
            dayOfWeek: row.dayOfWeek,
            startTime: row.startTime,
            endTime: row.endTime,
            venue: null,
            generatedBy: TimetableGeneratedBy.AI,
            approvalStatus: TimetableApprovalStatus.PENDING_REVIEW,
          },
        });
      }
    });
  }
}
