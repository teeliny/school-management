import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CreateTermDto, UpdateTermDto } from "./dto/term.dto";

@Injectable()
export class TermService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTermDto) {
    return this.prisma.term.create({ data: dto });
  }

  findAll(academicSessionId?: string) {
    return this.prisma.term.findMany({
      where: academicSessionId ? { academicSessionId } : undefined,
      orderBy: { startDate: "asc" },
    });
  }

  findOne(id: string) {
    return this.prisma.term.findUniqueOrThrow({ where: { id } });
  }

  update(id: string, dto: UpdateTermDto) {
    return this.prisma.term.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.term.delete({ where: { id } });
  }
}

@Controller("terms")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class TermController {
  constructor(private readonly service: TermService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  create(@Body() dto: CreateTermDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  update(@Param("id") id: string, @Body() dto: UpdateTermDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "AcademicStructure"))
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
