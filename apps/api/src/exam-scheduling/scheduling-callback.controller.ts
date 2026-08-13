import { Body, Controller, Logger, Param, Post, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import {
  ClassLevelCategoryGroup,
  DayOfWeek,
  InvigilationRole,
  ScheduleGenerationStatus,
  ScheduleScope,
  TimetableApprovalStatus,
  TimetableGeneratedBy,
} from "@prisma/client";
import { DAYS_OF_WEEK } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification";
import { TimetableSlotService } from "../timetable/timetable-slot";
import { ExamScheduleService } from "./exam-schedule";
import { InvigilationAssignmentService } from "./invigilation-assignment";

interface ClassTimetableGeneratedRow {
  classArmId: string;
  subjectId: string;
  staffId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
}

interface ExamTimetableGeneratedRow {
  classArmId: string;
  subjectId: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface InvigilationGeneratedRow {
  examScheduleId: string;
  staffId: string;
  role: string;
}

interface WeeklyDutyGeneratedRow {
  classLevelCategoryGroup: string;
  weekStartDate: string;
  staffId: string;
}

interface SchedulingCallbackBody {
  callbackToken: string;
  result?: {
    generatedRows?:
      | ClassTimetableGeneratedRow[]
      | ExamTimetableGeneratedRow[]
      | InvigilationGeneratedRow[]
      | WeeklyDutyGeneratedRow[];
  };
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

function isInvigilationRole(value: string): value is InvigilationRole {
  return value === InvigilationRole.LEAD || value === InvigilationRole.ASSISTANT;
}

function isClassLevelCategoryGroup(value: string): value is ClassLevelCategoryGroup {
  return value === ClassLevelCategoryGroup.JSS_SSS || value === ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY;
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
    private readonly examSchedules: ExamScheduleService,
    private readonly invigilationAssignments: InvigilationAssignmentService,
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

    const rows = (body.result?.generatedRows ?? []) as
      | ClassTimetableGeneratedRow[]
      | ExamTimetableGeneratedRow[]
      | InvigilationGeneratedRow[]
      | WeeklyDutyGeneratedRow[];
    let persistedCount = 0;

    if (request.scope === ScheduleScope.CLASS_TIMETABLE) {
      persistedCount = await this.persistClassTimetableRows(requestId, request.termId, rows as ClassTimetableGeneratedRow[]);
    }
    if (request.scope === ScheduleScope.EXAM_TIMETABLE) {
      persistedCount = await this.persistExamTimetableRows(
        requestId,
        request.assessmentComponentId,
        rows as ExamTimetableGeneratedRow[],
      );
    }
    if (request.scope === ScheduleScope.INVIGILATION) {
      persistedCount = await this.persistInvigilationRows(requestId, rows as InvigilationGeneratedRow[]);
    }
    if (request.scope === ScheduleScope.WEEKLY_DUTY) {
      persistedCount = await this.persistWeeklyDutyRows(requestId, rows as WeeklyDutyGeneratedRow[]);
    }

    await this.prisma.scheduleGenerationRequest.update({
      where: { id: requestId },
      data: {
        status: ScheduleGenerationStatus.COMPLETED,
        completedAt: new Date(),
        // Roster-level human review — separate from `status` above. Only
        // enters PENDING_REVIEW once at least one row actually landed; a
        // completed-but-empty run (every row dropped as unparseable) has
        // nothing for the batch approve/reject endpoints to act on.
        reviewStatus: persistedCount > 0 ? TimetableApprovalStatus.PENDING_REVIEW : undefined,
      },
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
  private async persistClassTimetableRows(requestId: string, termId: string | null, rows: ClassTimetableGeneratedRow[]) {
    if (!termId) {
      this.logger.warn("CLASS_TIMETABLE callback with no termId on the request — nothing to persist");
      return 0;
    }
    if (rows.length === 0) return 0;

    const term = await this.prisma.term.findUniqueOrThrow({ where: { id: termId } });
    let persisted = 0;

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
            scheduleGenerationRequestId: requestId,
          },
        });
        persisted += 1;
      }
    });
    return persisted;
  }

  /**
   * BUILD_PLAN.md §9 Step 3: persists the solver's result as `ExamSchedule`
   * rows (`generatedBy=AI, approvalStatus=PENDING_REVIEW`, same not-visible-
   * until-approved shape as Step 2's `TimetableSlot` rows, FR6.5). Reuses
   * `ExamScheduleService.assertNoConflicts` per row inside a single
   * transaction, same belt-and-suspenders pattern as
   * `persistClassTimetableRows` — no `staffId`/venue involved here, since
   * `ExamSchedule` has neither (PRD §3.8).
   */
  private async persistExamTimetableRows(
    requestId: string,
    assessmentComponentId: string | null,
    rows: ExamTimetableGeneratedRow[],
  ) {
    if (!assessmentComponentId) {
      this.logger.warn("EXAM_TIMETABLE callback with no assessmentComponentId on the request — nothing to persist");
      return 0;
    }
    if (rows.length === 0) return 0;
    let persisted = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const date = new Date(row.date);
        if (Number.isNaN(date.getTime())) {
          this.logger.warn(`Dropping generated row with unparseable date "${row.date}"`);
          continue;
        }

        await this.examSchedules.assertNoConflicts(
          { classArmId: row.classArmId, date, startTime: row.startTime, endTime: row.endTime },
          undefined,
          tx,
        );

        await tx.examSchedule.create({
          data: {
            assessmentComponentId,
            classArmId: row.classArmId,
            subjectId: row.subjectId,
            date,
            startTime: row.startTime,
            endTime: row.endTime,
            venue: null,
            generatedBy: TimetableGeneratedBy.AI,
            approvalStatus: TimetableApprovalStatus.PENDING_REVIEW,
            scheduleGenerationRequestId: requestId,
          },
        });
        persisted += 1;
      }
    });
    return persisted;
  }

  /**
   * BUILD_PLAN.md §9 Step 4: persists the solver's result as
   * `InvigilationAssignment` rows (`generatedBy=AI, approvalStatus=
   * PENDING_REVIEW`, same not-visible-until-approved shape as Steps 2/3).
   * Reuses `InvigilationAssignmentService.assertNoConflicts` per row inside
   * a single transaction — same belt-and-suspenders pattern, checking the
   * staff member isn't already invigilating an overlapping exam.
   */
  private async persistInvigilationRows(requestId: string, rows: InvigilationGeneratedRow[]) {
    if (rows.length === 0) return 0;
    let persisted = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        if (!isInvigilationRole(row.role)) {
          this.logger.warn(`Dropping generated row with unrecognized role "${row.role}"`);
          continue;
        }

        await this.invigilationAssignments.assertNoConflicts(row.staffId, row.examScheduleId, tx);

        await tx.invigilationAssignment.create({
          data: {
            examScheduleId: row.examScheduleId,
            staffId: row.staffId,
            role: row.role,
            generatedBy: TimetableGeneratedBy.AI,
            approvalStatus: TimetableApprovalStatus.PENDING_REVIEW,
            scheduleGenerationRequestId: requestId,
          },
        });
        persisted += 1;
      }
    });
    return persisted;
  }

  /**
   * BUILD_PLAN.md §9 Step 5: persists the solver's result as
   * `DutyAssignment` rows (`generatedBy=AI, approvalStatus=PENDING_REVIEW`,
   * same not-visible-until-approved shape as Steps 2-4). No dedicated
   * conflict-check service here — unlike TimetableSlot/ExamSchedule/
   * InvigilationAssignment, a duty row has no overlap concept to check
   * per-row; the re-trigger guard in `assertValidWeeklyDutyRequest`
   * (schedule-generation-request.ts) already rejects triggering generation
   * against a term/group that's already rostered, and the DB's
   * `@@unique([weekStartDate, classLevelCategoryGroup, staffId])` is the
   * final backstop against a duplicate row within one run.
   */
  private async persistWeeklyDutyRows(requestId: string, rows: WeeklyDutyGeneratedRow[]) {
    if (rows.length === 0) return 0;
    let persisted = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        if (!isClassLevelCategoryGroup(row.classLevelCategoryGroup)) {
          this.logger.warn(`Dropping generated row with unrecognized classLevelCategoryGroup "${row.classLevelCategoryGroup}"`);
          continue;
        }
        const weekStartDate = new Date(row.weekStartDate);
        if (Number.isNaN(weekStartDate.getTime())) {
          this.logger.warn(`Dropping generated row with unparseable weekStartDate "${row.weekStartDate}"`);
          continue;
        }

        await tx.dutyAssignment.create({
          data: {
            classLevelCategoryGroup: row.classLevelCategoryGroup,
            weekStartDate,
            staffId: row.staffId,
            generatedBy: TimetableGeneratedBy.AI,
            approvalStatus: TimetableApprovalStatus.PENDING_REVIEW,
            scheduleGenerationRequestId: requestId,
          },
        });
        persisted += 1;
      }
    });
    return persisted;
  }
}
