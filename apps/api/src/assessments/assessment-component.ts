import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AssessmentComponentStatus, ClassLevelCategory } from "@prisma/client";
import { isStructureComplete } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { CreateAssessmentComponentDto, UpdateAssessmentComponentDto } from "./dto/assessment-component.dto";

@Injectable()
export class AssessmentComponentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD §3.6: "the full set of components defined for that pair sums to
   * 100" — checked before any component in the (termId, classLevelCategory)
   * group can move to OPEN. Shared with the worker's sweep via the pure
   * `isStructureComplete` (packages/types) so both sides apply the same
   * rule.
   */
  async assertStructureComplete(termId: string, classLevelCategory: ClassLevelCategory) {
    const components = await this.prisma.assessmentComponent.findMany({
      where: { termId, classLevelCategory },
      select: { maxScore: true },
    });
    const maxScores = components.map((c) => Number(c.maxScore));
    if (!isStructureComplete(maxScores)) {
      throw new BadRequestException(
        `Components for this term/class group sum to ${maxScores.reduce((s, v) => s + v, 0)}, not 100 — cannot open until the structure is complete`,
      );
    }
  }

  create(dto: CreateAssessmentComponentDto, userId: string) {
    return this.prisma.assessmentComponent.create({
      data: { ...dto, createdByUserId: userId },
    });
  }

  update(id: string, dto: UpdateAssessmentComponentDto) {
    return this.prisma.assessmentComponent.update({ where: { id }, data: dto });
  }

  findAll(filters: { termId?: string; classLevelCategory?: ClassLevelCategory }) {
    return this.prisma.assessmentComponent.findMany({
      where: filters,
      orderBy: [{ type: "asc" }, { sequence: "asc" }],
    });
  }

  findOne(id: string) {
    return this.prisma.assessmentComponent.findUniqueOrThrow({ where: { id } });
  }

  remove(id: string) {
    return this.prisma.assessmentComponent.delete({ where: { id } });
  }

  async forceOpen(id: string) {
    const component = await this.prisma.assessmentComponent.findUniqueOrThrow({ where: { id } });
    await this.assertStructureComplete(component.termId, component.classLevelCategory);
    return this.prisma.assessmentComponent.update({
      where: { id },
      data: { status: AssessmentComponentStatus.OPEN },
    });
  }

  forceClose(id: string) {
    return this.prisma.assessmentComponent.update({
      where: { id },
      data: { status: AssessmentComponentStatus.CLOSED },
    });
  }

  forcePublish(id: string) {
    return this.prisma.assessmentComponent.update({
      where: { id },
      data: { status: AssessmentComponentStatus.PUBLISHED },
    });
  }
}

@Controller("assessment-components")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AssessmentComponentController {
  constructor(private readonly service: AssessmentComponentService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "AssessmentComponent"))
  create(@Body() dto: CreateAssessmentComponentDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  findAll(@Query("termId") termId?: string, @Query("classLevelCategory") classLevelCategory?: ClassLevelCategory) {
    return this.service.findAll({ termId, classLevelCategory });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "AssessmentComponent"))
  update(@Param("id") id: string, @Body() dto: UpdateAssessmentComponentDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "AssessmentComponent"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  @Patch(":id/force-open")
  @CheckPolicies((ability) => ability.can("manage", "AssessmentComponent"))
  forceOpen(@Param("id") id: string) {
    return this.service.forceOpen(id);
  }

  @Patch(":id/force-close")
  @CheckPolicies((ability) => ability.can("manage", "AssessmentComponent"))
  forceClose(@Param("id") id: string) {
    return this.service.forceClose(id);
  }

  @Patch(":id/force-publish")
  @CheckPolicies((ability) => ability.can("manage", "AssessmentComponent"))
  forcePublish(@Param("id") id: string) {
    return this.service.forcePublish(id);
  }
}
