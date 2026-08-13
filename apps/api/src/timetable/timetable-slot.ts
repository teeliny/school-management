import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ClassLevelCategoryGroup, DayOfWeek, Prisma, TimetableApprovalStatus, TimetableGeneratedBy } from "@prisma/client";
import { categoryToGroup, timeRangesOverlap } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
import { withDisplayName } from "../academic-structure/class-arm";
import { CreateTimetableSlotDto, UpdateTimetableSlotDto } from "./dto/timetable-slot.dto";

interface ConflictCheckInput {
  staffId: string;
  venue?: string | null;
  dayOfWeek: DayOfWeek;
  academicSessionId: string;
  termId: string;
  startTime: string;
  endTime: string;
}

@Injectable()
export class TimetableSlotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD §3.8: "validated for teacher/venue double-booking conflicts at the
   * service layer regardless of origin" — a range comparison, not something
   * a DB unique constraint can express, so it lives here rather than as a
   * schema-level guarantee. `client` defaults to the injected PrismaService
   * but accepts a `$transaction` callback's client too — BUILD_PLAN.md §9
   * Step 2's callback controller reuses this as a final safety net while
   * batch-inserting AI-generated rows, and needs each check to see the
   * batch's own prior inserts, not just what's already committed.
   */
  async assertNoConflicts(
    input: ConflictCheckInput,
    excludeId?: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const shared = {
      dayOfWeek: input.dayOfWeek,
      academicSessionId: input.academicSessionId,
      termId: input.termId,
      id: excludeId ? { not: excludeId } : undefined,
    } as const;

    const staffSlots = await client.timetableSlot.findMany({
      where: { ...shared, staffId: input.staffId },
    });
    for (const slot of staffSlots) {
      if (timeRangesOverlap(input.startTime, input.endTime, slot.startTime, slot.endTime)) {
        throw new BadRequestException(
          `Teacher is already booked from ${slot.startTime} to ${slot.endTime} on this day`,
        );
      }
    }

    if (input.venue) {
      const venueSlots = await client.timetableSlot.findMany({
        where: { ...shared, venue: input.venue },
      });
      for (const slot of venueSlots) {
        if (timeRangesOverlap(input.startTime, input.endTime, slot.startTime, slot.endTime)) {
          throw new BadRequestException(
            `Venue "${input.venue}" is already booked from ${slot.startTime} to ${slot.endTime} on this day`,
          );
        }
      }
    }
  }

  async create(dto: CreateTimetableSlotDto, userId: string) {
    await this.assertNoConflicts(dto);
    return this.prisma.timetableSlot.create({
      data: {
        ...dto,
        generatedBy: TimetableGeneratedBy.MANUAL,
        approvalStatus: TimetableApprovalStatus.APPROVED,
        approvedByUserId: userId,
        approvedAt: new Date(),
      },
    });
  }

  async update(id: string, dto: UpdateTimetableSlotDto) {
    const existing = await this.prisma.timetableSlot.findUniqueOrThrow({ where: { id } });
    await this.assertNoConflicts({ ...existing, ...dto }, id);
    return this.prisma.timetableSlot.update({ where: { id }, data: dto });
  }

  // A parent caller may only ever see their own wards' classes — mirrors
  // TermReportCardService.findForUser's PARENT branch (StudentGuardian join
  // to the wards' currentClassId). Returns `null` for "no scoping needed"
  // (any other caller) so findAll can tell "unrestricted" apart from "scoped
  // to zero classes."
  private async resolveParentScopedClassArmIds(user: RequestUser): Promise<string[] | null> {
    if (!user.roles.includes("PARENT")) return null;
    const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
    if (!parentProfile) return [];
    const wards = await this.prisma.studentProfile.findMany({
      where: { guardians: { some: { parentId: parentProfile.id } } },
      select: { currentClassId: true },
    });
    return wards.map((w) => w.currentClassId).filter((id): id is string => Boolean(id));
  }

  // PRD §5 footnote 6: the whole-school "all classes" overview (no single
  // classArmId requested) scopes Principal to JSS/SSS and Headteacher to
  // Creche/Nursery/Primary — Super-Admin/Admin/Registrar stay unscoped. Only
  // applies to this no-classArmId "view everything" case, not to a request
  // for one specific class arm (Principal/Headteacher's unconditioned
  // "manage TimetableSlot" CASL grant already lets them touch any single
  // class's rows today).
  private async resolveCategoryGroupScopedClassArmIds(user: RequestUser): Promise<string[] | null> {
    const isPrincipal = user.assignmentTypes.includes("PRINCIPAL");
    const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");
    if (!isPrincipal && !isHeadteacher) return null;
    if (user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("REGISTRAR")) return null;

    const allowedGroup = isPrincipal ? ClassLevelCategoryGroup.JSS_SSS : ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY;
    const classArms = await this.prisma.classArm.findMany({
      select: { id: true, classLevel: { select: { category: true } } },
    });
    return classArms.filter((arm) => categoryToGroup(arm.classLevel.category) === allowedGroup).map((arm) => arm.id);
  }

  async findAll(
    filters: {
      classArmId?: string;
      staffId?: string;
      academicSessionId?: string;
      termId?: string;
      approvalStatus?: TimetableApprovalStatus;
    },
    user?: RequestUser,
  ) {
    let classArmWhere: Prisma.TimetableSlotWhereInput["classArmId"] = filters.classArmId;

    if (user) {
      const parentScoped = await this.resolveParentScopedClassArmIds(user);
      if (parentScoped !== null) {
        if (filters.classArmId) {
          if (!parentScoped.includes(filters.classArmId)) return [];
        } else if (parentScoped.length === 0) {
          return [];
        } else {
          classArmWhere = { in: parentScoped };
        }
      } else if (!filters.classArmId) {
        const groupScoped = await this.resolveCategoryGroupScopedClassArmIds(user);
        if (groupScoped !== null) {
          if (groupScoped.length === 0) return [];
          classArmWhere = { in: groupScoped };
        }
      }
    }

    const rows = await this.prisma.timetableSlot.findMany({
      where: {
        staffId: filters.staffId,
        academicSessionId: filters.academicSessionId,
        termId: filters.termId,
        classArmId: classArmWhere,
        approvalStatus: filters.approvalStatus ?? TimetableApprovalStatus.APPROVED,
      },
      include: {
        classArm: { include: { classLevel: { select: { name: true } } } },
        subject: true,
        staff: { include: { user: true } },
      },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });
    // withDisplayName (academic-structure/class-arm.ts) is the one place
    // "{ClassLevel.name} {ClassArm.name}" is formatted — reused here so the
    // approvals queue renders the same "JSS 1 DIAMOND" shape the class-arm
    // dropdowns already use, instead of re-deriving it client-side.
    return rows.map((row) => ({ ...row, classArm: withDisplayName(row.classArm) }));
  }

  findOne(id: string) {
    return this.prisma.timetableSlot.findUniqueOrThrow({ where: { id } });
  }

  remove(id: string) {
    return this.prisma.timetableSlot.delete({ where: { id } });
  }
}

@Controller("timetable-slots")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class TimetableSlotController {
  constructor(
    private readonly service: TimetableSlotService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  create(@Body() dto: CreateTimetableSlotDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.create(dto, user.id);
  }

  // Defaults to APPROVED-only when approvalStatus is omitted — a
  // PENDING_REVIEW/DRAFT/REJECTED row is AI-generated-but-not-yet-published
  // (or explicitly rejected) draft state, FR6.5's "not visible to staff,
  // students, or parents until approved." Requesting anything else requires
  // the same manage-check used for create/update/delete, reusing existing
  // CASL infra rather than adding a new Subject just for this filter.
  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("classArmId") classArmId?: string,
    @Query("staffId") staffId?: string,
    @Query("academicSessionId") academicSessionId?: string,
    @Query("termId") termId?: string,
    @Query("approvalStatus") approvalStatus?: TimetableApprovalStatus,
  ) {
    if (approvalStatus && approvalStatus !== TimetableApprovalStatus.APPROVED) {
      this.assertCanManage(user);
    }
    return this.service.findAll({ classArmId, staffId, academicSessionId, termId, approvalStatus }, user);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateTimetableSlotDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.remove(id);
  }

  // Registrar is a StaffAssignment.assignmentType, not a Role — this attribute
  // check is on the *acting user*, not the resource, so it's not expressible
  // as a @CheckPolicies decorator the way resource-scoped rules are.
  private assertCanManage(user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "TimetableSlot")) {
      throw new ForbiddenException("Insufficient permissions to manage the timetable");
    }
  }
}
