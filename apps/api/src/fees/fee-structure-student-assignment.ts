import { BadRequestException, Body, Controller, Get, Injectable, Post, Query, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { computeInvoiceStatus, computeOutstandingBalance } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { AssignStudentToFeeStructureDto } from "./dto/assign-student-to-fee-structure.dto";

const ASSIGNMENT_DETAIL_INCLUDE = {
  feeStructure: true,
  student: { include: { user: true } },
} satisfies Prisma.FeeStructureStudentAssignmentInclude;

/**
 * Bursar/Super-Admin-mediated opt-in for one student into one optional
 * (isMandatory=false) FeeStructure — FeeStructure itself only scopes to a
 * class level or the whole school (FeeStructureClassLevel), it can't target
 * an individual student. This is deliberately not parent self-service:
 * FeeStructure is never exposed to parents (ability.factory.ts).
 */
@Injectable()
export class FeeStructureStudentAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: AssignStudentToFeeStructureDto, user: RequestUser) {
    const feeStructure = await this.prisma.feeStructure.findUniqueOrThrow({
      where: { id: dto.feeStructureId },
      include: { classLevels: true },
    });
    if (feeStructure.isMandatory) {
      throw new BadRequestException("Only an optional (non-mandatory) fee structure can be opted into per student");
    }

    const student = await this.prisma.studentProfile.findUniqueOrThrow({
      where: { id: dto.studentId },
      include: { currentClass: { select: { classLevelId: true } } },
    });
    const classApplies =
      feeStructure.classLevels.length === 0 ||
      feeStructure.classLevels.some((cl) => cl.classLevelId === student.currentClass?.classLevelId);
    if (!classApplies) {
      throw new BadRequestException("This fee structure does not apply to the student's class");
    }

    const existing = await this.prisma.feeStructureStudentAssignment.findUnique({
      where: { feeStructureId_studentId: { feeStructureId: dto.feeStructureId, studentId: dto.studentId } },
    });
    if (existing) {
      throw new BadRequestException("Student has already opted into this fee");
    }

    const staffProfile = await this.prisma.staffProfile.findUnique({ where: { userId: user.id } });

    const assignment = await this.prisma.feeStructureStudentAssignment.create({
      data: { feeStructureId: dto.feeStructureId, studentId: dto.studentId, recordedByStaffId: staffProfile?.id ?? null },
    });

    // If this term's REGULAR invoice for the student doesn't exist yet, the
    // assignment is picked up automatically the next time InvoiceService.
    // generate runs for that term — nothing more to do here.
    const regularInvoice = await this.prisma.invoice.findFirst({
      where: { studentId: dto.studentId, termId: feeStructure.termId, source: "REGULAR" },
    });
    if (!regularInvoice) {
      return { assignment, supplementaryInvoice: null };
    }

    // A REGULAR invoice already exists — bill every still-pending assignment
    // for this student+term (not just the one just created) so several
    // opt-ins landing close together don't each spawn their own invoice. The
    // REGULAR invoice itself is never touched. If an open (not yet fully
    // PAID) SUPPLEMENTARY invoice already exists for this student+term, the
    // new item(s) are appended to it instead of starting another one — a
    // parent opting into things at different times still only ever has at
    // most one outstanding supplementary invoice to pay. Once that invoice
    // is fully paid, the next opt-in starts a fresh one.
    const pending = await this.prisma.feeStructureStudentAssignment.findMany({
      where: { studentId: dto.studentId, invoiceId: null, feeStructure: { termId: feeStructure.termId, isMandatory: false } },
      include: { feeStructure: true },
    });
    const pendingTotal = pending.reduce((sum, a) => sum + Number(a.feeStructure.amount), 0);

    const openSupplementaryInvoice = await this.prisma.invoice.findFirst({
      where: { studentId: dto.studentId, termId: feeStructure.termId, source: "SUPPLEMENTARY", status: { not: "PAID" } },
      include: { lineItems: true, payments: true },
      orderBy: { generatedAt: "desc" },
    });

    const supplementaryInvoice = await this.prisma.$transaction(async (tx) => {
      let invoice: { id: string; dueDate: Date };

      if (openSupplementaryInvoice) {
        invoice = openSupplementaryInvoice;
        const newTotalAmount = Number(openSupplementaryInvoice.totalAmount) + pendingTotal;
        const discountAmounts = openSupplementaryInvoice.lineItems.filter((li) => li.type === "DISCOUNT").map((li) => Number(li.amount));
        const successfulPaymentAmounts = openSupplementaryInvoice.payments
          .filter((p) => p.status === "SUCCESSFUL")
          .map((p) => Number(p.amount));
        const outstandingBalance = computeOutstandingBalance(newTotalAmount, discountAmounts, successfulPaymentAmounts);
        const paidTotal = successfulPaymentAmounts.reduce((sum, amount) => sum + amount, 0);
        const status = computeInvoiceStatus(outstandingBalance, paidTotal, openSupplementaryInvoice.dueDate, new Date());
        await tx.invoice.update({ where: { id: openSupplementaryInvoice.id }, data: { totalAmount: newTotalAmount, status } });
      } else {
        invoice = await tx.invoice.create({
          data: {
            studentId: dto.studentId,
            termId: feeStructure.termId,
            totalAmount: pendingTotal,
            dueDate: dto.dueDate ?? regularInvoice.dueDate,
            source: "SUPPLEMENTARY",
          },
        });
      }

      await tx.invoiceLineItem.createMany({
        data: pending.map((a) => ({
          invoiceId: invoice.id,
          feeStructureId: a.feeStructureId,
          type: "FEE",
          amount: a.feeStructure.amount,
          description: a.feeStructure.name,
        })),
      });
      await tx.feeStructureStudentAssignment.updateMany({
        where: { id: { in: pending.map((a) => a.id) } },
        data: { invoiceId: invoice.id },
      });
      return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    });

    return {
      assignment: await this.prisma.feeStructureStudentAssignment.findUniqueOrThrow({ where: { id: assignment.id } }),
      supplementaryInvoice,
    };
  }

  findAll(feeStructureId?: string, studentId?: string) {
    return this.prisma.feeStructureStudentAssignment.findMany({
      where: { feeStructureId, studentId },
      include: ASSIGNMENT_DETAIL_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }
}

// PRD §3.9/§5: the whole fees domain is Bursar/Super-Admin only, same as
// FeeStructureController — no parent-facing route exists here.
@Controller("fee-structure-student-assignments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class FeeStructureStudentAssignmentController {
  constructor(private readonly service: FeeStructureStudentAssignmentService) {}

  @Post()
  @CheckPolicies((ability) => ability.can("manage", "FeeStructureStudentAssignment"))
  @Audited("FeeStructureStudentAssignment")
  create(@Body() dto: AssignStudentToFeeStructureDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @CheckPolicies((ability) => ability.can("manage", "FeeStructureStudentAssignment"))
  findAll(@Query("feeStructureId") feeStructureId?: string, @Query("studentId") studentId?: string) {
    return this.service.findAll(feeStructureId, studentId);
  }
}
