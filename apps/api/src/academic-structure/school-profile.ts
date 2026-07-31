import { Controller, Get, Injectable, NotFoundException, Patch, Body, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { UpdateSchoolProfileDto } from "./dto/school-profile.dto";

@Injectable()
export class SchoolProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const profile = await this.prisma.schoolProfile.findFirst();
    if (!profile) throw new NotFoundException("School has not been set up yet — run `pnpm setup:school`");
    return profile;
  }

  async update(dto: UpdateSchoolProfileDto) {
    const profile = await this.get();
    return this.prisma.schoolProfile.update({ where: { id: profile.id }, data: dto });
  }
}

@Controller("school-profile")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SchoolProfileController {
  constructor(private readonly service: SchoolProfileService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Patch()
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  update(@Body() dto: UpdateSchoolProfileDto) {
    return this.service.update(dto);
  }
}
