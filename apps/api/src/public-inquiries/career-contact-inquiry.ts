import { Body, Controller, Get, Injectable, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { InquiryStatus, Role } from "@prisma/client";
import { ThrottlerGuard } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { NotificationService } from "../notifications/notification";
import { CreateCareerContactInquiryDto } from "./dto/career-contact-inquiry.dto";

@Injectable()
export class CareerContactInquiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async submit(dto: CreateCareerContactInquiryDto) {
    // Honeypot tripped — see AdmissionInquiryService.submit.
    if (dto.website) {
      return { received: true };
    }

    const inquiry = await this.prisma.careerContactInquiry.create({
      data: {
        type: dto.type,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        subject: dto.subject,
        message: dto.message,
      },
    });

    await this.notifyStaff(inquiry);
    return { received: true };
  }

  // Super-Admin/Admin only — Registrar/Principal/Headteacher are notified
  // of admission inquiries alone (AdmissionInquiryService.notifyStaff).
  private async notifyStaff(inquiry: { type: string; fullName: string; email: string; message: string }) {
    const admins = await this.prisma.user.findMany({
      where: { roles: { some: { role: { in: [Role.SUPER_ADMIN, Role.ADMIN] }, isActive: true } } },
      select: { id: true },
    });

    const vars = {
      type: inquiry.type === "CAREERS" ? "careers" : "general contact",
      fullName: inquiry.fullName,
      email: inquiry.email,
      message: inquiry.message,
    };

    await Promise.all(
      admins.map((u) => this.notifications.notify(u.id, "CAREER_CONTACT_INQUIRY_RECEIVED", vars)),
    );
  }

  findAll() {
    return this.prisma.careerContactInquiry.findMany({ orderBy: { createdAt: "desc" } });
  }

  async markReviewed(id: string) {
    const existing = await this.prisma.careerContactInquiry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Careers/contact inquiry not found");
    return this.prisma.careerContactInquiry.update({ where: { id }, data: { status: InquiryStatus.REVIEWED } });
  }
}

// Public, unauthenticated — see AdmissionInquiryPublicController.
@Controller("career-contact-inquiries")
export class CareerContactInquiryPublicController {
  constructor(private readonly service: CareerContactInquiryService) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  submit(@Body() dto: CreateCareerContactInquiryDto) {
    return this.service.submit(dto);
  }
}

@Controller("career-contact-inquiries")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class CareerContactInquiryAdminController {
  constructor(private readonly service: CareerContactInquiryService) {}

  @Get()
  @CheckPolicies((ability) => ability.can("read", "CareerContactInquiry"))
  findAll() {
    return this.service.findAll();
  }

  @Patch(":id")
  @CheckPolicies((ability) => ability.can("manage", "CareerContactInquiry"))
  markReviewed(@Param("id") id: string) {
    return this.service.markReviewed(id);
  }
}
