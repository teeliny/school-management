import { BadRequestException, Body, Controller, Delete, Get, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { Audited } from "../audit/audited.decorator";
import { CreateSchoolHolidayDto, CreateSchoolHolidayRangeDto, UpdateSchoolHolidayDto } from "./dto/school-holiday.dto";

// A break longer than this is almost certainly a data-entry mistake (start/
// end dates swapped, or a full-term date picked by accident) rather than a
// real mid-term break — fail fast instead of silently creating months of
// holiday rows.
const MAX_RANGE_DAYS = 60;

@Injectable()
export class SchoolHolidayService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSchoolHolidayDto) {
    return this.prisma.schoolHoliday.create({ data: dto });
  }

  /**
   * Fans a date range out into one SchoolHoliday row per day (per-day rows
   * are the shape computeSchoolDaysOpened expects, PRD §3.7) — added once a
   * real mid-term break (Monday–Friday) turned out to need 5 separate
   * single-day submissions through the existing form. `skipDuplicates`
   * handles a range that happens to overlap an already-declared holiday
   * (e.g. a public holiday during the break) without 500ing on the date's
   * unique constraint.
   */
  async createRange(dto: CreateSchoolHolidayRangeDto) {
    if (dto.startDate > dto.endDate) {
      throw new BadRequestException("startDate must be on or before endDate");
    }
    const dayCount = Math.round((dto.endDate.getTime() - dto.startDate.getTime()) / 86_400_000) + 1;
    if (dayCount > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Range spans ${dayCount} days — must be ${MAX_RANGE_DAYS} or fewer`);
    }

    const skipWeekends = dto.skipWeekends ?? true;
    const dates: Date[] = [];
    const cursor = new Date(
      Date.UTC(dto.startDate.getUTCFullYear(), dto.startDate.getUTCMonth(), dto.startDate.getUTCDate()),
    );
    const endUtc = Date.UTC(dto.endDate.getUTCFullYear(), dto.endDate.getUTCMonth(), dto.endDate.getUTCDate());
    while (cursor.getTime() <= endUtc) {
      const dayOfWeek = cursor.getUTCDay();
      if (!skipWeekends || (dayOfWeek !== 0 && dayOfWeek !== 6)) {
        dates.push(new Date(cursor));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    await this.prisma.schoolHoliday.createMany({
      data: dates.map((date) => ({
        name: dto.name,
        date,
        academicSessionId: dto.academicSessionId,
        termId: dto.termId,
      })),
      skipDuplicates: true,
    });

    return this.prisma.schoolHoliday.findMany({
      where: { date: { in: dates } },
      orderBy: { date: "asc" },
    });
  }

  findAll() {
    return this.prisma.schoolHoliday.findMany({ orderBy: { date: "asc" } });
  }

  findOne(id: string) {
    return this.prisma.schoolHoliday.findUniqueOrThrow({ where: { id } });
  }

  update(id: string, dto: UpdateSchoolHolidayDto) {
    return this.prisma.schoolHoliday.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.schoolHoliday.delete({ where: { id } });
  }
}

@Controller("school-holidays")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SchoolHolidayController {
  constructor(private readonly service: SchoolHolidayService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "SchoolHoliday"))
  @Audited("SchoolHoliday")
  create(@Body() dto: CreateSchoolHolidayDto) {
    return this.service.create(dto);
  }

  @Post("range")
  @CheckPolicies((ability) => ability.can("manage", "SchoolHoliday"))
  @Audited("SchoolHoliday")
  createRange(@Body() dto: CreateSchoolHolidayRangeDto) {
    return this.service.createRange(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "SchoolHoliday"))
  @Audited("SchoolHoliday", "schoolHoliday")
  update(@Param("id") id: string, @Body() dto: UpdateSchoolHolidayDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "SchoolHoliday"))
  @Audited("SchoolHoliday", "schoolHoliday")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
