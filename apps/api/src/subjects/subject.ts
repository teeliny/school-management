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
import { SubjectType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateSubjectDto, CreateSubjectGroupChildDto, CreateSubjectGroupDto, UpdateSubjectDto } from "./dto/subject.dto";

const SUBJECT_DETAIL_INCLUDE = {
  childSubjects: true,
  groupWeightsAsGroup: { include: { childSubject: true } },
} as const;

@Injectable()
export class SubjectService {
  constructor(private readonly prisma: PrismaService) {}

  private assertDepartmentConsistency(type: SubjectType, departmentId?: string) {
    if (type === SubjectType.DEPARTMENT && !departmentId) {
      throw new BadRequestException("departmentId is required for a DEPARTMENT subject");
    }
    if (type !== SubjectType.DEPARTMENT && departmentId) {
      throw new BadRequestException("departmentId is only valid for a DEPARTMENT subject");
    }
  }

  create(dto: CreateSubjectDto) {
    this.assertDepartmentConsistency(dto.type, dto.departmentId);
    return this.prisma.subject.create({
      data: {
        name: dto.name,
        code: dto.code,
        type: dto.type,
        departmentId: dto.departmentId,
        requiresCalculation: dto.requiresCalculation ?? false,
      },
    });
  }

  /**
   * PRD §3.3: the "Basic Science and Technology" path — one parent
   * (isGroup=true) + N independently-scored children, each linked back via
   * parentSubjectId and given a SubjectGroupWeight row, all created
   * atomically so a partial group can never be persisted.
   */
  async createGroup(dto: CreateSubjectGroupDto) {
    this.assertDepartmentConsistency(dto.type, dto.departmentId);

    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.subject.create({
        data: {
          name: dto.name,
          code: dto.code,
          type: dto.type,
          departmentId: dto.departmentId,
          requiresCalculation: dto.requiresCalculation ?? false,
          isGroup: true,
        },
      });

      for (const child of dto.children) {
        const childSubject = await tx.subject.create({
          data: {
            name: child.name,
            code: child.code,
            type: dto.type,
            departmentId: dto.departmentId,
            parentSubjectId: parent.id,
          },
        });
        await tx.subjectGroupWeight.create({
          data: {
            groupSubjectId: parent.id,
            childSubjectId: childSubject.id,
            weight: child.weight,
          },
        });
      }

      return tx.subject.findUniqueOrThrow({ where: { id: parent.id }, include: SUBJECT_DETAIL_INCLUDE });
    });
  }

  /**
   * Adds one independently-scored child to an already-existing group (PRD
   * §3.3) — the group itself and its other children/weights are untouched.
   * Mirrors createGroup's per-child shape (same parent type/departmentId,
   * new SubjectGroupWeight row) so a child added later is indistinguishable
   * from one created with the group initially.
   */
  async addGroupChild(parentId: string, dto: CreateSubjectGroupChildDto) {
    const parent = await this.prisma.subject.findUniqueOrThrow({ where: { id: parentId } });
    if (!parent.isGroup) {
      throw new BadRequestException("Only a grouped subject can have child subjects added to it");
    }

    return this.prisma.$transaction(async (tx) => {
      const childSubject = await tx.subject.create({
        data: {
          name: dto.name,
          code: dto.code,
          type: parent.type,
          departmentId: parent.departmentId ?? undefined,
          parentSubjectId: parent.id,
        },
      });
      await tx.subjectGroupWeight.create({
        data: { groupSubjectId: parent.id, childSubjectId: childSubject.id, weight: dto.weight },
      });

      return tx.subject.findUniqueOrThrow({ where: { id: parent.id }, include: SUBJECT_DETAIL_INCLUDE });
    });
  }

  findAll(filters: { type?: SubjectType; departmentId?: string; isGroup?: boolean }) {
    return this.prisma.subject.findMany({
      where: {
        type: filters.type,
        departmentId: filters.departmentId,
        isGroup: filters.isGroup,
        // Children of a group are only ever listed via their parent's detail
        // view, not the top-level catalogue.
        parentSubjectId: null,
      },
      orderBy: { name: "asc" },
    });
  }

  findOne(id: string) {
    return this.prisma.subject.findUniqueOrThrow({ where: { id }, include: SUBJECT_DETAIL_INCLUDE });
  }

  update(id: string, dto: UpdateSubjectDto) {
    if (dto.type) {
      this.assertDepartmentConsistency(dto.type, dto.departmentId);
    }
    return this.prisma.subject.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.subject.delete({ where: { id } });
  }

  /**
   * Catalogue-wide disable/enable — distinct from ClassSubjectTermStatus's
   * per-class-per-term disable (subjects/class-subject-term-status.ts).
   * Applies to any Subject, including a group's child, everywhere at once.
   */
  setActive(id: string, isActive: boolean) {
    return this.prisma.subject.update({ where: { id }, data: { isActive } });
  }
}

@Controller("subjects")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SubjectController {
  constructor(private readonly service: SubjectService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "Subject"))
  create(@Body() dto: CreateSubjectDto) {
    return this.service.create(dto);
  }

  @Post("groups")
  @CheckPolicies((ability) => ability.can("manage", "Subject"))
  createGroup(@Body() dto: CreateSubjectGroupDto) {
    return this.service.createGroup(dto);
  }

  @Post(":id/children")
  @CheckPolicies((ability) => ability.can("manage", "Subject"))
  addGroupChild(@Param("id") id: string, @Body() dto: CreateSubjectGroupChildDto) {
    return this.service.addGroupChild(id, dto);
  }

  @Get()
  findAll(
    @Query("type") type?: SubjectType,
    @Query("departmentId") departmentId?: string,
    @Query("isGroup") isGroup?: string,
  ) {
    return this.service.findAll({
      type,
      departmentId,
      isGroup: isGroup === undefined ? undefined : isGroup === "true",
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "Subject"))
  update(@Param("id") id: string, @Body() dto: UpdateSubjectDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "Subject"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  @Patch(":id/disable")
  @CheckPolicies((ability) => ability.can("manage", "Subject"))
  disable(@Param("id") id: string) {
    return this.service.setActive(id, false);
  }

  @Patch(":id/enable")
  @CheckPolicies((ability) => ability.can("manage", "Subject"))
  enable(@Param("id") id: string) {
    return this.service.setActive(id, true);
  }
}
