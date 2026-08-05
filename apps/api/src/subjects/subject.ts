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

  create(dto: CreateSubjectDto) {
    return this.prisma.subject.create({
      data: {
        name: dto.name,
        code: dto.code,
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
    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.subject.create({
        data: {
          name: dto.name,
          code: dto.code,
          requiresCalculation: dto.requiresCalculation ?? false,
          isGroup: true,
        },
      });

      for (const child of dto.children) {
        const childSubject = await tx.subject.create({
          data: {
            name: child.name,
            code: child.code,
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
          parentSubjectId: parent.id,
        },
      });
      await tx.subjectGroupWeight.create({
        data: { groupSubjectId: parent.id, childSubjectId: childSubject.id, weight: dto.weight },
      });

      return tx.subject.findUniqueOrThrow({ where: { id: parent.id }, include: SUBJECT_DETAIL_INCLUDE });
    });
  }

  findAll(filters: { isGroup?: boolean; search?: string }) {
    return this.prisma.subject.findMany({
      where: {
        isGroup: filters.isGroup,
        // Children of a group are only ever listed via their parent's detail
        // view, not the top-level catalogue — but are included inline below
        // so the catalogue UI can expand a group row to show them.
        parentSubjectId: null,
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: "insensitive" as const } },
                { code: { contains: filters.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      include: {
        childSubjects: true,
        // Which class group(s) this subject is assigned to, and how
        // (type/department) — this is how the catalogue answers "what group
        // is this subject in" without going back to one Subject row per
        // group (that's the duplication this table move was meant to
        // eliminate — see ClassSubject). Not session-scoped: ClassSubject
        // isn't tied to an AcademicSession at all.
        classSubjects: {
          select: {
            id: true,
            classLevelCategory: true,
            type: true,
            departmentId: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    });
  }

  findOne(id: string) {
    return this.prisma.subject.findUniqueOrThrow({ where: { id }, include: SUBJECT_DETAIL_INCLUDE });
  }

  update(id: string, dto: UpdateSubjectDto) {
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
  findAll(@Query("isGroup") isGroup?: string, @Query("search") search?: string) {
    return this.service.findAll({
      isGroup: isGroup === undefined ? undefined : isGroup === "true",
      search,
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
