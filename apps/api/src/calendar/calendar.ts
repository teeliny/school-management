import { BadRequestException, Controller, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { buildCalendarEntries, type CalendarComponentScheduleInput } from "./calendar.util";

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD §3.11: visibility isn't sensitive here (scheduling dates, not
   * scores) — any authenticated user can read the calendar; which event
   * types a role emphasizes by default is a frontend concern, not enforced
   * here.
   */
  async getEvents(from: Date, to: Date) {
    const [terms, components, windows, holidays, schoolEvents, examScheduleGroups] = await Promise.all([
      this.prisma.term.findMany({ where: { startDate: { lte: to }, endDate: { gte: from } } }),
      this.prisma.assessmentComponent.findMany({
        where: {
          OR: [
            { inputOpensAt: { gte: from, lte: to } },
            { inputClosesAt: { gte: from, lte: to } },
            { publishAt: { gte: from, lte: to } },
          ],
        },
      }),
      this.prisma.reportWindow.findMany({
        where: {
          OR: [{ inputOpensAt: { gte: from, lte: to } }, { inputClosesAt: { gte: from, lte: to } }],
        },
      }),
      this.prisma.schoolHoliday.findMany({ where: { date: { gte: from, lte: to } } }),
      this.prisma.schoolEvent.findMany({
        where: { date: { lte: to }, OR: [{ endDate: null, date: { gte: from } }, { endDate: { gte: from } }] },
      }),
      // Not date-range-filtered here — a component's full min/max exam
      // period is computed first, then the same overlap check as Term is
      // applied in buildCalendarEntries, so a query window that only covers
      // part of an exam period doesn't truncate the range shown.
      this.prisma.examSchedule.groupBy({
        by: ["assessmentComponentId"],
        where: { approvalStatus: "APPROVED" },
        _min: { date: true },
        _max: { date: true },
      }),
    ]);

    const scheduleComponents = examScheduleGroups.length
      ? await this.prisma.assessmentComponent.findMany({
          where: { id: { in: examScheduleGroups.map((g) => g.assessmentComponentId) } },
          select: { id: true, name: true },
        })
      : [];
    const examSchedules: CalendarComponentScheduleInput[] = examScheduleGroups.map((group) => ({
      componentId: group.assessmentComponentId,
      name: scheduleComponents.find((c) => c.id === group.assessmentComponentId)?.name ?? "Exam",
      minDate: group._min.date as Date,
      maxDate: group._max.date as Date,
    }));

    return buildCalendarEntries(terms, components, windows, holidays, schoolEvents, examSchedules, from, to);
  }
}

@Controller("calendar")
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  @Get()
  getEvents(@Query("from") from?: string, @Query("to") to?: string) {
    if (!from || !to) {
      throw new BadRequestException("from and to query params are required (ISO date strings)");
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException("from and to must be valid dates");
    }
    return this.service.getEvents(fromDate, toDate);
  }
}
