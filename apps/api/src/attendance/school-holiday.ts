import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateSchoolHolidayDto, UpdateSchoolHolidayDto } from "./dto/school-holiday.dto";

@Injectable()
export class SchoolHolidayService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSchoolHolidayDto) {
    return this.prisma.schoolHoliday.create({ data: dto });
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
  create(@Body() dto: CreateSchoolHolidayDto) {
    return this.service.create(dto);
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
  update(@Param("id") id: string, @Body() dto: UpdateSchoolHolidayDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "SchoolHoliday"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
