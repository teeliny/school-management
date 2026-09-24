import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { PoliciesGuard } from "../../casl/policies.guard";
import { CheckPolicies } from "../../casl/check-policies.decorator";
import { CurrentUser } from "../../auth/current-user.decorator";
import type { RequestUser } from "../../auth/jwt.strategy";
import { AbilityFactory } from "../../casl/ability.factory";
import { Audited } from "../../audit/audited.decorator";
import { AuthService } from "../../auth/auth.service";
import { UserService } from "../users/user.service";
import { UpdateParentProfileDto, UpdateParentEmailDto } from "./dto/parent-profile.dto";

// Wards are included so the Admin-facing /parents page can show each
// parent's children and their current class without an N+1 fetch.
const PARENT_WITH_WARDS_INCLUDE = {
  user: true,
  wards: {
    include: {
      student: {
        select: {
          id: true,
          admissionNumber: true,
          status: true,
          user: { select: { firstName: true, lastName: true, middleName: true } },
          currentClass: { select: { id: true, name: true, classLevel: { select: { name: true, order: true } } } },
        },
      },
    },
  },
} satisfies Prisma.ParentProfileInclude;

@Injectable()
export class ParentProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  findAll(filters: { emailBounced?: boolean } = {}) {
    return this.prisma.parentProfile.findMany({
      where: { emailBounced: filters.emailBounced },
      include: PARENT_WITH_WARDS_INCLUDE,
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
    });
  }

  findOne(id: string) {
    return this.prisma.parentProfile.findUniqueOrThrow({ where: { id }, include: PARENT_WITH_WARDS_INCLUDE });
  }

  findByUserId(userId: string) {
    return this.prisma.parentProfile.findUnique({ where: { userId } });
  }

  // `phone` and the name fields live on User, not ParentProfile — written
  // in the same transaction as the ParentProfile fields so a self-service
  // edit (parent updating their own contact info) or an Admin edit stays
  // atomic.
  async update(id: string, dto: UpdateParentProfileDto) {
    const { phone, firstName, lastName, middleName, ...profileFields } = dto;
    const userFields = { phone, firstName, lastName, middleName };
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.parentProfile.update({ where: { id }, data: profileFields });
      if (Object.values(userFields).some((v) => v !== undefined)) {
        await tx.user.update({ where: { id: profile.userId }, data: userFields });
      }
      return tx.parentProfile.findUniqueOrThrow({ where: { id }, include: { user: true } });
    });
  }

  /**
   * One-time, staff-driven email correction (see ParentProfile.
   * emailChangedByStaffAt) — mainly for guardians onboarded via the legacy
   * CSV import (legacy-import.service.ts) who often start with a synthetic
   * placeholder address. Setting the real email is what actually lets the
   * parent log in: it triggers AuthService.forgotPassword, reusing the
   * existing password-reset flow rather than a new invite/email mechanism
   * — this only works because the import already activates the User
   * (status: active) with an unknown random password.
   */
  async updateEmail(id: string, newEmail: string) {
    const profile = await this.prisma.parentProfile.findUniqueOrThrow({ where: { id }, include: { user: true } });
    if (profile.emailChangedByStaffAt) {
      throw new BadRequestException("This parent's email has already been changed once and cannot be changed again here.");
    }

    const email = UserService.normalizeEmail(newEmail);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== profile.userId) {
      // The "real" email turns out to already belong to someone else's
      // account (e.g. this guardian is actually already a Staff/Admin user)
      // — merge into that account instead of rejecting outright, same
      // FR1.5 "one person, one account" reuse StudentService.resolveGuardian
      // already does when a brand-new guardian entry's email matches an
      // existing user.
      return this.mergeIntoExistingAccount(profile.id, existing.id);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: profile.userId }, data: { email } }),
      this.prisma.parentProfile.update({ where: { id }, data: { emailChangedByStaffAt: new Date() } }),
    ]);

    await this.authService.forgotPassword(email);

    return this.prisma.parentProfile.findUniqueOrThrow({ where: { id }, include: { user: true } });
  }

  /**
   * Re-points every StudentGuardian currently on `sourceProfileId` to the
   * existing user's ParentProfile (granting the PARENT role first if it
   * doesn't already have it), rather than changing the source profile's own
   * email to one that's already taken. The source ParentProfile/User row is
   * deliberately left in place afterward, just unlinked from any student —
   * it's usually a placeholder account from a legacy import, but it isn't
   * this method's place to decide it's safe to delete.
   */
  private async mergeIntoExistingAccount(sourceProfileId: string, existingUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.userService.grantRole(existingUserId, Role.PARENT, tx);

      const destProfile =
        (await tx.parentProfile.findUnique({ where: { userId: existingUserId } })) ??
        (await tx.parentProfile.create({ data: { userId: existingUserId } }));

      const links = await tx.studentGuardian.findMany({ where: { parentId: sourceProfileId } });
      for (const link of links) {
        const duplicate = await tx.studentGuardian.findUnique({
          where: { studentId_parentId: { studentId: link.studentId, parentId: destProfile.id } },
        });
        if (duplicate) {
          // This student already separately lists the existing account as a
          // guardian — drop the now-redundant link rather than collide with
          // StudentGuardian's [studentId, parentId] uniqueness.
          await tx.studentGuardian.delete({ where: { id: link.id } });
        } else {
          await tx.studentGuardian.update({ where: { id: link.id }, data: { parentId: destProfile.id } });
        }
      }

      return tx.parentProfile.findUniqueOrThrow({ where: { id: destProfile.id }, include: { user: true } });
    });
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

  // "read" rather than "manage" so Registrar/Bursar get the view-only
  // /parents directory; Admin/Super-Admin satisfy it via "manage".
  @Get()
  @CheckPolicies((ability) => ability.can("read", "ParentProfile"))
  findAll(@Query("emailBounced") emailBounced?: string) {
    return this.service.findAll({ emailBounced: emailBounced === undefined ? undefined : emailBounced === "true" });
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    const profile = await this.service.findOne(id);
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("read", "ParentProfile") && profile.userId !== user.id) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return profile;
  }

  @Patch(":id")
  @Audited("ParentProfile", "parentProfile")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateParentProfileDto,
    @CurrentUser() user: RequestUser,
  ) {
    const profile = await this.service.findOne(id);
    const ability = this.abilityFactory.createForUser(user);
    const canManage = ability.can("manage", "ParentProfile");
    if (!canManage && profile.userId !== user.id) {
      throw new ForbiddenException("Insufficient permissions");
    }
    // A self-service edit may only change contact info — the name fields
    // are Admin/Super-Admin data (same narrowing as StaffProfileController.
    // update), even though the ownership check above lets the request through.
    return this.service.update(
      id,
      canManage
        ? dto
        : {
            phone: dto.phone,
            address: dto.address,
            occupation: dto.occupation,
            relationshipToStudentDefault: dto.relationshipToStudentDefault,
          },
    );
  }

  // Deliberately its own route/ability rather than folded into the general
  // PATCH above — see ability.factory.ts's "updateEmail" Action comment.
  // Super-Admin already has it via "manage all"; Registrar gets it
  // narrowly, without the broader "manage ParentProfile" grant.
  @Patch(":id/email")
  @CheckPolicies((ability) => ability.can("updateEmail", "ParentProfile"))
  @Audited("ParentProfile", "parentProfile")
  updateEmail(@Param("id") id: string, @Body() dto: UpdateParentEmailDto) {
    return this.service.updateEmail(id, dto.email);
  }
}
