import { Body, Controller, Get, Injectable, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AssignmentType, InquiryStatus, Role } from "@prisma/client";
import { ThrottlerGuard } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { NotificationService } from "../notifications/notification";
import { CreateAdmissionInquiryDto } from "./dto/admission-inquiry.dto";

@Injectable()
export class AdmissionInquiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async submit(dto: CreateAdmissionInquiryDto) {
    // Honeypot tripped — a real visitor never fills or even sees this
    // field. Return the same shape a genuine submission gets without
    // persisting or notifying anyone, so a bot can't tell it was dropped.
    if (dto.website) {
      return { received: true };
    }

    const inquiry = await this.prisma.admissionInquiry.create({
      data: {
        parentFullName: dto.parentFullName,
        parentEmail: dto.parentEmail,
        parentPhone: dto.parentPhone,
        studentFullName: dto.studentFullName,
        desiredEntryClass: dto.desiredEntryClass,
        message: dto.message,
      },
    });

    await this.notifyStaff(inquiry);
    return { received: true };
  }

  // Super-Admin/Admin get every admission inquiry; whoever currently holds
  // an active REGISTRAR/PRINCIPAL/HEADTEACHER assignment gets it too — the
  // user-facing distinction from CareerContactInquiryService.notifyStaff,
  // which only notifies Super-Admin/Admin.
  private async notifyStaff(inquiry: {
    id: string;
    parentFullName: string;
    parentEmail: string;
    studentFullName: string | null;
    desiredEntryClass: string;
    message: string;
  }) {
    const [admins, titledStaff] = await Promise.all([
      this.prisma.user.findMany({
        where: { roles: { some: { role: { in: [Role.SUPER_ADMIN, Role.ADMIN] }, isActive: true } } },
        select: { id: true },
      }),
      this.prisma.staffAssignment.findMany({
        where: {
          assignmentType: { in: [AssignmentType.REGISTRAR, AssignmentType.PRINCIPAL, AssignmentType.HEADTEACHER] },
          isActive: true,
        },
        select: { staff: { select: { userId: true } } },
      }),
    ]);

    const recipientUserIds = new Set<string>([
      ...admins.map((u) => u.id),
      ...titledStaff.map((a) => a.staff.userId),
    ]);

    const vars = {
      parentFullName: inquiry.parentFullName,
      parentEmail: inquiry.parentEmail,
      studentFullName: inquiry.studentFullName ?? "—",
      desiredEntryClass: inquiry.desiredEntryClass,
      message: inquiry.message,
    };

    await Promise.all(
      [...recipientUserIds].map((userId) => this.notifications.notify(userId, "ADMISSION_INQUIRY_RECEIVED", vars)),
    );
  }

  findAll() {
    return this.prisma.admissionInquiry.findMany({ orderBy: { createdAt: "desc" } });
  }

  async markReviewed(id: string) {
    const existing = await this.prisma.admissionInquiry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Admission inquiry not found");
    return this.prisma.admissionInquiry.update({ where: { id }, data: { status: InquiryStatus.REVIEWED } });
  }
}

/**
 * Public, unauthenticated — a prospective parent has no account. Same
 * unguarded-controller pattern as SetupController/InvitationsController
 * (no @Public()-style guard bypass exists in this codebase; a public route
 * is simply a controller with no @UseGuards at all). Rate-limited via
 * ThrottlerGuard scoped to just this route so no other endpoint's behavior
 * changes.
 */
@Controller("admission-inquiries")
export class AdmissionInquiryPublicController {
  constructor(private readonly service: AdmissionInquiryService) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  submit(@Body() dto: CreateAdmissionInquiryDto) {
    return this.service.submit(dto);
  }
}

@Controller("admission-inquiries")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class AdmissionInquiryAdminController {
  constructor(private readonly service: AdmissionInquiryService) {}

  @Get()
  @CheckPolicies((ability) => ability.can("read", "AdmissionInquiry"))
  findAll() {
    return this.service.findAll();
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "AdmissionInquiry"))
  markReviewed(@Param("id") id: string) {
    return this.service.markReviewed(id);
  }
}
