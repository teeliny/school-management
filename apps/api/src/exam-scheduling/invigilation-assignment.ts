import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { timeRangesOverlap } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * BUILD_PLAN.md §9 Step 4: no manual CRUD yet (read endpoints arrive with
 * Step 6/7's approval/overview UI, same precedent as `ExamScheduleService`)
 * — exists purely to back `SchedulingCallbackController`'s persistence with
 * a final safety net on top of the solver's own no-double-booking
 * avoidance. Unlike `ExamScheduleService` (keyed by classArmId+date),
 * `InvigilationAssignment` conflicts are about the *staff member* being
 * double-booked across two exams — potentially different class arms — at
 * overlapping times on the same date.
 */
@Injectable()
export class InvigilationAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async assertNoConflicts(
    staffId: string,
    examScheduleId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const target = await client.examSchedule.findUniqueOrThrow({ where: { id: examScheduleId } });

    const otherAssignments = await client.invigilationAssignment.findMany({
      where: { staffId, examScheduleId: { not: examScheduleId } },
      include: { examSchedule: true },
    });

    for (const assignment of otherAssignments) {
      if (assignment.examSchedule.date.getTime() !== target.date.getTime()) continue;
      if (timeRangesOverlap(target.startTime, target.endTime, assignment.examSchedule.startTime, assignment.examSchedule.endTime)) {
        throw new BadRequestException(
          `Staff member is already invigilating another exam from ${assignment.examSchedule.startTime} to ${assignment.examSchedule.endTime} on this date`,
        );
      }
    }
  }
}
