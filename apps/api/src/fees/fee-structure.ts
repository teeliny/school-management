import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { Audited } from "../audit/audited.decorator";
import { CreateFeeStructureDto, UpdateFeeStructureDto } from "./dto/fee-structure.dto";

const FEE_STRUCTURE_INCLUDE = { classLevels: { include: { classLevel: true } } } satisfies Prisma.FeeStructureInclude;

@Injectable()
export class FeeStructureService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateFeeStructureDto) {
    const { classLevelIds, ...rest } = dto;
    return this.prisma.feeStructure.create({
      data: {
        ...rest,
        classLevels: classLevelIds?.length ? { create: classLevelIds.map((classLevelId) => ({ classLevelId })) } : undefined,
      },
      include: FEE_STRUCTURE_INCLUDE,
    });
  }

  // classLevelId filters to fee structures that apply to that class level —
  // either scoped directly to it, or school-wide (zero classLevels rows).
  findAll(termId?: string, classLevelId?: string) {
    return this.prisma.feeStructure.findMany({
      where: {
        termId,
        ...(classLevelId
          ? { OR: [{ classLevels: { none: {} } }, { classLevels: { some: { classLevelId } } }] }
          : {}),
      },
      include: FEE_STRUCTURE_INCLUDE,
      orderBy: { name: "asc" },
    });
  }

  findOne(id: string) {
    return this.prisma.feeStructure.findUniqueOrThrow({ where: { id }, include: FEE_STRUCTURE_INCLUDE });
  }

  // classLevelIds, if present in the DTO, fully replaces the existing set
  // (delete-then-recreate — this join table has no other data on its rows to
  // preserve, same "just swap the set" shape as StaffAssignment's sync).
  async update(id: string, dto: UpdateFeeStructureDto) {
    const { classLevelIds, ...rest } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (classLevelIds !== undefined) {
        await tx.feeStructureClassLevel.deleteMany({ where: { feeStructureId: id } });
        if (classLevelIds.length) {
          await tx.feeStructureClassLevel.createMany({ data: classLevelIds.map((classLevelId) => ({ feeStructureId: id, classLevelId })) });
        }
      }
      return tx.feeStructure.update({ where: { id }, data: rest, include: FEE_STRUCTURE_INCLUDE });
    });
  }

  remove(id: string) {
    return this.prisma.feeStructure.delete({ where: { id } });
  }
}

// PRD §3.9/§5: the whole fees domain (this controller included) is Bursar/
// Super-Admin only — not even a plain Admin can read it, so every method
// here (including the two GETs) is gated, unlike most other CRUD
// controllers in this codebase where reads are open to any authenticated
// user.
@Controller("fee-structures")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class FeeStructureController {
  constructor(private readonly service: FeeStructureService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "FeeStructure"))
  @Audited("FeeStructure", "feeStructure")
  create(@Body() dto: CreateFeeStructureDto) {
    return this.service.create(dto);
  }

  @Get()
  @CheckPolicies((ability) => ability.can("manage", "FeeStructure"))
  findAll(@Query("termId") termId?: string, @Query("classLevelId") classLevelId?: string) {
    return this.service.findAll(termId, classLevelId);
  }

  @Get(":id")
  @CheckPolicies((ability) => ability.can("manage", "FeeStructure"))
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "FeeStructure"))
  @Audited("FeeStructure", "feeStructure")
  update(@Param("id") id: string, @Body() dto: UpdateFeeStructureDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @CheckPolicies((ability) => ability.can("manage", "FeeStructure"))
  @Audited("FeeStructure", "feeStructure")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
