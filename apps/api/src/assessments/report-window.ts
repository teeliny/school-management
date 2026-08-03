import {
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
import { ReportWindowStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { CreateReportWindowDto, UpdateReportWindowDto } from "./dto/report-window.dto";

@Injectable()
export class ReportWindowService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateReportWindowDto, userId: string) {
    return this.prisma.reportWindow.create({ data: { ...dto, createdByUserId: userId } });
  }

  update(id: string, dto: UpdateReportWindowDto) {
    return this.prisma.reportWindow.update({ where: { id }, data: dto });
  }

  findAll(filters: { termId?: string; classLevelId?: string }) {
    return this.prisma.reportWindow.findMany({ where: filters });
  }

  findOne(id: string) {
    return this.prisma.reportWindow.findUniqueOrThrow({ where: { id } });
  }

  remove(id: string) {
    return this.prisma.reportWindow.delete({ where: { id } });
  }

  forceOpen(id: string) {
    return this.prisma.reportWindow.update({ where: { id }, data: { status: ReportWindowStatus.OPEN } });
  }

  forceClose(id: string) {
    return this.prisma.reportWindow.update({ where: { id }, data: { status: ReportWindowStatus.CLOSED } });
  }
}

@Controller("report-windows")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ReportWindowController {
  constructor(private readonly service: ReportWindowService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  create(@Body() dto: CreateReportWindowDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  findAll(@Query("termId") termId?: string, @Query("classLevelId") classLevelId?: string) {
    return this.service.findAll({ termId, classLevelId });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  update(@Param("id") id: string, @Body() dto: UpdateReportWindowDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }

  @Patch(":id/force-open")
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  forceOpen(@Param("id") id: string) {
    return this.service.forceOpen(id);
  }

  @Patch(":id/force-close")
  @CheckPolicies((ability) => ability.can("manage", "ReportWindow"))
  forceClose(@Param("id") id: string) {
    return this.service.forceClose(id);
  }
}
