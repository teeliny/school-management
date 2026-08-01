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
import { UpdateParentProfileDto } from "./dto/parent-profile.dto";

@Injectable()
export class ParentProfileService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.parentProfile.findMany({ include: { user: true } });
  }

  findOne(id: string) {
    return this.prisma.parentProfile.findUniqueOrThrow({ where: { id }, include: { user: true } });
  }

  findByUserId(userId: string) {
    return this.prisma.parentProfile.findUnique({ where: { userId } });
  }

  update(id: string, dto: UpdateParentProfileDto) {
    return this.prisma.parentProfile.update({ where: { id }, data: dto });
  }
}

// ParentProfile rows are seeded at invite time, or inline during student
// creation for a brand-new guardian (see invitation.service.ts, student.ts)
// — no create endpoint here.
@Controller("parent-profiles")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ParentProfileController {
  constructor(
    private readonly service: ParentProfileService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Get()
  @CheckPolicies((ability) => ability.can("manage", "ParentProfile"))
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const profile = await this.service.findOne(id);
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "ParentProfile") && profile.userId !== user.id) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return profile;
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateParentProfileDto,
    @CurrentUser() user: RequestUser,
  ) {
    const profile = await this.service.findOne(id);
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "ParentProfile") && profile.userId !== user.id) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return this.service.update(id, dto);
  }
}
