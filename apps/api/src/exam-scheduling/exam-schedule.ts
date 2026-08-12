import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { timeRangesOverlap } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

interface ExamConflictCheckInput {
  classArmId: string;
  date: Date;
  startTime: string;
  endTime: string;
}

/**
 * BUILD_PLAN.md §9 Step 3: no manual CRUD yet (read endpoints arrive with
 * Step 6/7's approval/overview UI, matching PRD's FR6.7 grouping) — this
 * exists purely to back `SchedulingCallbackController`'s persistence with
 * the same "conflict check as a final safety net on top of the solver's own
 * avoidance" pattern `TimetableSlotService.assertNoConflicts` established in
 * Step 2. Keyed by (classArmId, date) instead of (staffId/venue, dayOfWeek)
 * — `ExamSchedule` has no staffId (PRD §3.8: invigilation, Step 4, is a
 * separate staff pool not tied to the subject's own teacher).
 */
@Injectable()
export class ExamScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async assertNoConflicts(input: ExamConflictCheckInput, client: PrismaService | Prisma.TransactionClient = this.prisma) {
    const sameDaySlots = await client.examSchedule.findMany({
      where: { classArmId: input.classArmId, date: input.date },
    });
    for (const slot of sameDaySlots) {
      if (timeRangesOverlap(input.startTime, input.endTime, slot.startTime, slot.endTime)) {
        throw new BadRequestException(
          `Class arm already has an exam from ${slot.startTime} to ${slot.endTime} on this date`,
        );
      }
    }
  }
}
