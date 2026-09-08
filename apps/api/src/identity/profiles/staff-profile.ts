import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { PoliciesGuard } from "../../casl/policies.guard";
import { CheckPolicies } from "../../casl/check-policies.decorator";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { RequestUser } from "../../auth/jwt.strategy";
import { AbilityFactory } from "../../casl/ability.factory";
import { resolvePrincipalHeadteacherCategories } from "../../common/class-level-category-scope";
import { Audited } from "../../audit/audited.decorator";
import { UpdateStaffProfileDto } from "./dto/staff-profile.dto";

@Injectable()
export class StaffProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `user`, when supplied, narrows the roster for a Principal/Headteacher to
   * staff who actually pertain to their own section: anyone with no active
   * assignment yet (nothing to scope by — better to show them than hide a
   * not-yet-assigned hire), anyone holding a school-wide title (no
   * classArmId — BURSAR/REGISTRAR/PRINCIPAL/HEADTEACHER/VICE_PRINCIPAL/
   * OTHER — who serve the whole school regardless of section), and any
   * CLASS_TEACHER/SUBJECT_TEACHER whose class arm falls in that section.
   * A teacher assigned only to arms outside the caller's section is
   * excluded.
   */
  findAll(user?: RequestUser) {
    const categories = user ? resolvePrincipalHeadteacherCategories(user) : null;
    return this.prisma.staffProfile.findMany({
      where: categories
        ? {
            OR: [
              { assignments: { none: { isActive: true } } },
              {
                assignments: {
                  some: {
                    isActive: true,
                    OR: [{ classArmId: null }, { classArm: { classLevel: { category: { in: categories } } } }],
                  },
                },
              },
            ],
          }
        : undefined,
      include: { user: true },
    });
  }

  findOne(id: string) {
    return this.prisma.staffProfile.findUniqueOrThrow({ where: { id }, include: { user: true } });
  }

  /** Used by StaffAssignmentService to resolve a staff member's profile id from their userId. */
  findByUserId(userId: string) {
    return this.prisma.staffProfile.findUnique({ where: { userId } });
  }

  // `phone` lives on User, not StaffProfile — same split-write pattern as
  // ParentProfileService.update.
  async update(id: string, dto: UpdateStaffProfileDto) {
    const { phone, ...profileFields } = dto;
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.staffProfile.update({ where: { id }, data: profileFields });
      if (phone !== undefined) {
        await tx.user.update({ where: { id: profile.userId }, data: { phone } });
      }
      return tx.staffProfile.findUniqueOrThrow({ where: { id }, include: { user: true } });
    });
  }
}

// StaffProfile rows are seeded at invite time (see invitation.service.ts) —
// no create endpoint here.
@Controller("staff-profiles")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class StaffProfileController {
  constructor(
    private readonly service: StaffProfileService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Get()
  @CheckPolicies((ability) => ability.can("read", "StaffProfile"))
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user);
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const profile = await this.service.findOne(id);
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "StaffProfile") && profile.userId !== user.id) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return profile;
  }

  @Patch(":id")
  @Audited("StaffProfile", "staffProfile")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateStaffProfileDto,
    @CurrentUser() user: RequestUser,
  ) {
    const profile = await this.service.findOne(id);
    const ability = this.abilityFactory.createForUser(user);
    const canManage = ability.can("manage", "StaffProfile");
    if (!canManage && profile.userId !== user.id) {
      throw new ForbiddenException("Insufficient permissions");
    }
    // A self-service edit (no "manage" grant) may only change contact info
    // — employeeId/staffCategory/department/employmentDate/qualification/
    // status are Admin/Super-Admin HR data and stay out of reach even
    // though the ownership check above lets the request through.
    return this.service.update(id, canManage ? dto : { phone: dto.phone });
  }
}
