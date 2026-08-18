import { BadRequestException, Controller, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { buildCalendarEntries } from "./calendar.util";

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
    const [terms, components, windows] = await Promise.all([
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
    ]);

    return buildCalendarEntries(terms, components, windows, from, to);
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
