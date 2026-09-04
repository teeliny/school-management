import { BadRequestException, Controller, Injectable, NotFoundException, Param, Patch, UseGuards } from "@nestjs/common";
import { ClassLevelCategory, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";

type Tx = Prisma.TransactionClient | PrismaService;

// Per-ClassLevel disable/enable for a subject already assigned to a class
// group via ClassSubject — lets e.g. "Nursery 2" carry a subject the rest
// of NURSERY doesn't, by assigning it once at the category level (applies
// to every ClassLevel in the group by default) and disabling it here for
// every other ClassLevel in that group. Same sparse-override shape as
// ClassSubjectTermStatusService (absence of a row means active), just keyed
// by ClassLevel instead of Term — see the model comment in schema.prisma.
@Injectable()
export class ClassSubjectLevelStatusService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveClassSubjectAndLevel(classSubjectId: string, classLevelId: string) {
    const classSubject = await this.prisma.classSubject.findUnique({ where: { id: classSubjectId } });
    if (!classSubject) throw new NotFoundException("Class-subject assignment not found");

    const classLevel = await this.prisma.classLevel.findUnique({ where: { id: classLevelId } });
    if (!classLevel) throw new NotFoundException("Class level not found");

    if (classLevel.category !== classSubject.classLevelCategory) {
      throw new BadRequestException(
        `"${classLevel.name}" is in ${classLevel.category}, not ${classSubject.classLevelCategory} — this class-subject assignment doesn't apply to it`,
      );
    }

    return { classSubject, classLevel };
  }

  async setStatus(params: { classSubjectId: string; classLevelId: string }, isActive: boolean, userId: string) {
    await this.resolveClassSubjectAndLevel(params.classSubjectId, params.classLevelId);

    return this.prisma.classSubjectLevelStatus.upsert({
      where: {
        classSubjectId_classLevelId: {
          classSubjectId: params.classSubjectId,
          classLevelId: params.classLevelId,
        },
      },
      create: {
        classSubjectId: params.classSubjectId,
        classLevelId: params.classLevelId,
        isActive,
        disabledAt: isActive ? null : new Date(),
        disabledByUserId: isActive ? null : userId,
      },
      update: {
        isActive,
        disabledAt: isActive ? null : new Date(),
        disabledByUserId: isActive ? null : userId,
      },
    });
  }

  findForClassSubject(classSubjectId: string) {
    return this.prisma.classSubjectLevelStatus.findMany({
      where: { classSubjectId },
      include: { classLevel: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Consulted alongside ClassSubjectTermStatusService.assertActiveForTerm
   * everywhere a ClassSubject's applicability is resolved for one concrete
   * ClassLevel: a no-op if the subject is unaffected, a hard block if it's
   * been disabled for this specific ClassLevel. Same params shape as
   * assertActiveForTerm (subjectId + classLevelCategory, here plus
   * classLevelId) so call sites that already resolve both can pass them
   * straight through without a separate classSubjectId lookup.
   */
  async assertActiveForClassLevel(
    params: { subjectId: string; classLevelCategory: ClassLevelCategory; classLevelId: string },
    tx: Tx = this.prisma,
  ): Promise<void> {
    const subject = await tx.subject.findUnique({ where: { id: params.subjectId } });
    if (!subject) return;

    const classSubjectSubjectId = subject.parentSubjectId ?? subject.id;
    const classSubject = await tx.classSubject.findUnique({
      where: {
        classLevelCategory_subjectId: {
          classLevelCategory: params.classLevelCategory,
          subjectId: classSubjectSubjectId,
        },
      },
    });
    if (!classSubject) return;

    const status = await tx.classSubjectLevelStatus.findUnique({
      where: {
        classSubjectId_classLevelId: {
          classSubjectId: classSubject.id,
          classLevelId: params.classLevelId,
        },
      },
    });
    if (status && !status.isActive) {
      throw new BadRequestException(`${subject.name} is disabled for this class level`);
    }
  }
}

@Controller("class-subjects/:id/levels/:classLevelId")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ClassSubjectLevelStatusController {
  constructor(private readonly service: ClassSubjectLevelStatusService) {}

  @Patch("disable")
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  disable(@Param("id") id: string, @Param("classLevelId") classLevelId: string, @CurrentUser() user: RequestUser) {
    return this.service.setStatus({ classSubjectId: id, classLevelId }, false, user.id);
  }

  @Patch("enable")
  @CheckPolicies((ability) => ability.can("manage", "ClassSubject"))
  enable(@Param("id") id: string, @Param("classLevelId") classLevelId: string, @CurrentUser() user: RequestUser) {
    return this.service.setStatus({ classSubjectId: id, classLevelId }, true, user.id);
  }
}
