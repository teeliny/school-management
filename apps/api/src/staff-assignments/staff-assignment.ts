import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { subject } from "@casl/ability";
import { AssignmentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
import { CreateStaffAssignmentDto } from "./dto/staff-assignment.dto";

@Injectable()
export class StaffAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStaffAssignmentDto) {
    if (dto.assignmentType === AssignmentType.CLASS_TEACHER && !dto.classArmId) {
      throw new BadRequestException("classArmId is required for a CLASS_TEACHER assignment");
    }

    if (dto.assignmentType === AssignmentType.CLASS_TEACHER && !dto.allowCoTeaching) {
      // PRD FR3.3: prevent two active class teachers on the same ClassArm+
      // session by default — a service-layer check, not a DB constraint, so
      // Admin can deliberately override via `allowCoTeaching`.
      const existing = await this.prisma.staffAssignment.findFirst({
        where: {
          classArmId: dto.classArmId,
          academicSessionId: dto.academicSessionId,
          assignmentType: AssignmentType.CLASS_TEACHER,
          isActive: true,
        },
      });
      if (existing) {
        throw new BadRequestException(
          "This class arm already has an active class teacher for this session — pass allowCoTeaching to override",
        );
      }
    }

    const assignment = await this.prisma.staffAssignment.create({
      data: {
        staffId: dto.staffId,
        assignmentType: dto.assignmentType,
        classArmId: dto.classArmId,
        subjectId: dto.subjectId,
        academicSessionId: dto.academicSessionId,
        startDate: dto.startDate,
        endDate: dto.endDate,
      },
    });

    if (assignment.assignmentType === AssignmentType.CLASS_TEACHER) {
      await this.prisma.staffProfile.update({
        where: { id: assignment.staffId },
        data: { isClassTeacher: true },
      });
    }

    return assignment;
  }

  async revoke(id: string) {
    const assignment = await this.prisma.staffAssignment.findUniqueOrThrow({ where: { id } });
    if (!assignment.isActive) {
      throw new BadRequestException("Assignment is already inactive");
    }

    const revoked = await this.prisma.staffAssignment.update({
      where: { id },
      data: { isActive: false, endDate: new Date() },
    });

    if (assignment.assignmentType === AssignmentType.CLASS_TEACHER) {
      const stillClassTeacher = await this.prisma.staffAssignment.findFirst({
        where: { staffId: assignment.staffId, assignmentType: AssignmentType.CLASS_TEACHER, isActive: true },
      });
      if (!stillClassTeacher) {
        await this.prisma.staffProfile.update({
          where: { id: assignment.staffId },
          data: { isClassTeacher: false },
        });
      }
    }

    return revoked;
  }

  findAll(staffId?: string) {
    return this.prisma.staffAssignment.findMany({
      where: staffId ? { staffId } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  async findMine(userId: string) {
    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId } });
    if (!staffProfile) return [];
    return this.prisma.staffAssignment.findMany({
      where: { staffId: staffProfile.id },
      orderBy: { createdAt: "desc" },
    });
  }

  findOne(id: string) {
    return this.prisma.staffAssignment.findUniqueOrThrow({ where: { id } });
  }
}

@Controller("staff-assignments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class StaffAssignmentController {
  constructor(
    private readonly service: StaffAssignmentService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  async create(@Body() dto: CreateStaffAssignmentDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user, dto.assignmentType);
    return this.service.create(dto);
  }

  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query("staffId") staffId?: string) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "StaffAssignment")) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return this.service.findAll(staffId);
  }

  @Get("mine")
  findMine(@CurrentUser() user: RequestUser) {
    return this.service.findMine(user.id);
  }

  @Patch(":id/revoke")
  async revoke(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const assignment = await this.service.findOne(id);
    this.assertCanManage(user, assignment.assignmentType);
    return this.service.revoke(id);
  }

  private assertCanManage(user: RequestUser, assignmentType: AssignmentType) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", subject("StaffAssignment", { assignmentType }))) {
      // PRD FR3.1: BURSAR/REGISTRAR assignments are Super-Admin only.
      throw new ForbiddenException(
        "Insufficient permissions to manage this assignment type",
      );
    }
  }
}
