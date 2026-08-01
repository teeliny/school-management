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
import { UpdateAdminProfileDto } from "./dto/admin-profile.dto";

@Injectable()
export class AdminProfileService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.adminProfile.findMany({ include: { user: true } });
  }

  findOne(id: string) {
    return this.prisma.adminProfile.findUniqueOrThrow({ where: { id }, include: { user: true } });
  }

  update(id: string, dto: UpdateAdminProfileDto) {
    return this.prisma.adminProfile.update({ where: { id }, data: dto });
  }
}

// AdminProfile backs both SUPER_ADMIN and ADMIN roles (PRD §4) — there's no
// separate create endpoint here, since the row is seeded by
// InvitationService/setup-school at invite time (see invitation.service.ts).
@Controller("admin-profiles")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AdminProfileController {
  constructor(
    private readonly service: AdminProfileService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Get()
  @CheckPolicies((ability) => ability.can("manage", "AdminProfile"))
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const profile = await this.service.findOne(id);
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "AdminProfile") && profile.userId !== user.id) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return profile;
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateAdminProfileDto,
    @CurrentUser() user: RequestUser,
  ) {
    const profile = await this.service.findOne(id);
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "AdminProfile") && profile.userId !== user.id) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return this.service.update(id, dto);
  }
}
