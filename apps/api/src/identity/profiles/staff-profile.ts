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
import { UpdateStaffProfileDto } from "./dto/staff-profile.dto";

@Injectable()
export class StaffProfileService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.staffProfile.findMany({ include: { user: true } });
  }

  findOne(id: string) {
    return this.prisma.staffProfile.findUniqueOrThrow({ where: { id }, include: { user: true } });
  }

  /** Used by StaffAssignmentService to resolve a staff member's profile id from their userId. */
  findByUserId(userId: string) {
    return this.prisma.staffProfile.findUnique({ where: { userId } });
  }

  update(id: string, dto: UpdateStaffProfileDto) {
    return this.prisma.staffProfile.update({ where: { id }, data: dto });
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
  @CheckPolicies((ability) => ability.can("manage", "StaffProfile"))
  findAll() {
    return this.service.findAll();
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
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateStaffProfileDto,
    @CurrentUser() user: RequestUser,
  ) {
    const profile = await this.service.findOne(id);
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "StaffProfile") && profile.userId !== user.id) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return this.service.update(id, dto);
  }
}
