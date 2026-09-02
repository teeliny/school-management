import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateSchoolEventDto, UpdateSchoolEventDto } from "./dto/school-event.dto";

@Injectable()
export class SchoolEventService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSchoolEventDto) {
    return this.prisma.schoolEvent.create({ data: dto });
  }

  findAll() {
    return this.prisma.schoolEvent.findMany({ orderBy: { date: "asc" } });
  }

  findOne(id: string) {
    return this.prisma.schoolEvent.findUniqueOrThrow({ where: { id } });
  }

  update(id: string, dto: UpdateSchoolEventDto) {
    return this.prisma.schoolEvent.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.schoolEvent.delete({ where: { id } });
  }
}

// Read is open to any authenticated user (GET /calendar reads from here too,
// via CalendarService) — same "scheduling dates aren't sensitive" reasoning
// as SchoolHoliday/the calendar endpoint itself (PRD §3.11). Mutations are
// gated on "manage AcademicStructure", not a dedicated SchoolEvent subject —
// this is a small config resource in the same "who edits the school's
// operating structure" bucket as ClassLevel/ClassArm, not the
// attendance-specific SchoolHoliday grant.
@Controller("school-events")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SchoolEventController {
  constructor(private readonly service: SchoolEventService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  create(@Body() dto: CreateSchoolEventDto) {
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
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  update(@Param("id") id: string, @Body() dto: UpdateSchoolEventDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
