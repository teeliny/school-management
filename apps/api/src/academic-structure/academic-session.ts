import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateAcademicSessionDto, UpdateAcademicSessionDto } from "./dto/academic-session.dto";

@Injectable()
export class AcademicSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Subject assignments are meant to stay the same session-to-session by
   * default — admin only acts when curriculum/teacher availability changes
   * (disabling a subject for a specific term, or assigning/unassigning one
   * outright) — so a new session starts by carrying forward the
   * chronologically-preceding session's ClassSubject rows (including any
   * isCompulsoryOverride) rather than starting empty. Per-term disables
   * (ClassSubjectTermStatus) are keyed to specific Term rows and are
   * intentionally NOT carried forward — a disable from an old session's term
   * shouldn't silently apply to the new session's terms.
   */
  create(dto: CreateAcademicSessionDto) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.academicSession.create({ data: dto });

      const previousSession = await tx.academicSession.findFirst({
        where: { id: { not: session.id }, startDate: { lt: session.startDate } },
        orderBy: { startDate: "desc" },
      });

      if (previousSession) {
        const previousAssignments = await tx.classSubject.findMany({
          where: { academicSessionId: previousSession.id },
        });
        if (previousAssignments.length > 0) {
          await tx.classSubject.createMany({
            data: previousAssignments.map((assignment) => ({
              classLevelId: assignment.classLevelId,
              subjectId: assignment.subjectId,
              academicSessionId: session.id,
              isCompulsoryOverride: assignment.isCompulsoryOverride,
            })),
            skipDuplicates: true,
          });
        }
      }

      return session;
    });
  }

  findAll() {
    return this.prisma.academicSession.findMany({ orderBy: { startDate: "desc" } });
  }

  findOne(id: string) {
    return this.prisma.academicSession.findUniqueOrThrow({ where: { id } });
  }

  update(id: string, dto: UpdateAcademicSessionDto) {
    return this.prisma.academicSession.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.academicSession.delete({ where: { id } });
  }

  /**
   * PRD §3.2: exactly one AcademicSession is current at a time — enforced by
   * a partial unique index on `isCurrent` (prisma/migrations). Unsetting the
   * previous one before setting the new one, in the same transaction, is
   * what keeps that constraint satisfied at every point.
   */
  setCurrent(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.academicSession.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      return tx.academicSession.update({ where: { id }, data: { isCurrent: true } });
    });
  }
}

@Controller("academic-sessions")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AcademicSessionController {
  constructor(private readonly service: AcademicSessionService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  create(@Body() dto: CreateAcademicSessionDto) {
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
  update(@Param("id") id: string, @Body() dto: UpdateAcademicSessionDto) {
    return this.service.update(id, dto);
  }

  @Patch(":id/set-current")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  setCurrent(@Param("id") id: string) {
    return this.service.setCurrent(id);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
