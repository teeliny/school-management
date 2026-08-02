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
import { DayOfWeek, TimetableApprovalStatus, TimetableGeneratedBy } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
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

  private toMinutes(t: string): number {
    const [h, m] = t.split(":");
    return Number(h) * 60 + Number(m);
  }

  private overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
    return this.toMinutes(aStart) < this.toMinutes(bEnd) && this.toMinutes(bStart) < this.toMinutes(aEnd);
  }

  /**
   * PRD §3.8: "validated for teacher/venue double-booking conflicts at the
   * service layer regardless of origin" — a range comparison, not something
   * a DB unique constraint can express, so it lives here rather than as a
   * schema-level guarantee.
   */
  async assertNoConflicts(input: ConflictCheckInput, excludeId?: string) {
    const shared = {
      dayOfWeek: input.dayOfWeek,
      academicSessionId: input.academicSessionId,
      termId: input.termId,
      id: excludeId ? { not: excludeId } : undefined,
    } as const;

    const staffSlots = await this.prisma.timetableSlot.findMany({
      where: { ...shared, staffId: input.staffId },
    });
    for (const slot of staffSlots) {
      if (this.overlaps(input.startTime, input.endTime, slot.startTime, slot.endTime)) {
        throw new BadRequestException(
          `Teacher is already booked from ${slot.startTime} to ${slot.endTime} on this day`,
        );
      }
    }

    if (input.venue) {
      const venueSlots = await this.prisma.timetableSlot.findMany({
        where: { ...shared, venue: input.venue },
      });
      for (const slot of venueSlots) {
        if (this.overlaps(input.startTime, input.endTime, slot.startTime, slot.endTime)) {
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

  findAll(filters: { classArmId?: string; staffId?: string; academicSessionId?: string; termId?: string }) {
    return this.prisma.timetableSlot.findMany({
      where: filters,
      include: { subject: true, staff: { include: { user: true } } },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });
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

  @Get()
  findAll(
    @Query("classArmId") classArmId?: string,
    @Query("staffId") staffId?: string,
    @Query("academicSessionId") academicSessionId?: string,
    @Query("termId") termId?: string,
  ) {
    return this.service.findAll({ classArmId, staffId, academicSessionId, termId });
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
