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
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { InvigilationRole, Prisma, TimetableApprovalStatus } from "@prisma/client";
import { formatPersonName, timeRangesOverlap } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { Audited } from "../audit/audited.decorator";
import { UpdateInvigilationAssignmentDto } from "./dto/update-invigilation-assignment.dto";
import { SwapInvigilationAssignmentDto } from "./dto/swap-invigilation-assignment.dto";
import { withDisplayName } from "../academic-structure/class-arm";
import { resolvePrincipalHeadteacherCategories } from "../common/class-level-category-scope";
import { resolveSitting } from "./exam-sitting";
import { assertInvigilationEligible, findHardExcludedInvigilatorIds } from "./invigilation-eligibility";
import { ExamDayInvigilationService } from "./exam-day-invigilation";
import { pdfFileSlug, renderInvigilationRosterPdf, type InvigilationPdfDay } from "./exam-pdf.util";
import { ReassignInvigilationAssignmentsDto, SwapInvigilationGroupsDto } from "./dto/reassign-invigilation-assignments.dto";

/**
 * BUILD_PLAN.md §9 Step 4: no manual CRUD yet (read endpoints arrive with
 * Step 6/7's approval/overview UI, same precedent as `ExamScheduleService`)
 * — exists purely to back `SchedulingCallbackController`'s persistence with
 * a final safety net on top of the solver's own no-double-booking
 * avoidance. Unlike `ExamScheduleService` (keyed by classArmId+date),
 * `InvigilationAssignment` conflicts are about the *staff member* being
 * double-booked across two exams — potentially different class arms — at
 * overlapping times on the same date.
 */
@Injectable()
export class InvigilationAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly examDayInvigilations: ExamDayInvigilationService,
  ) {}

  async assertNoConflicts(
    staffId: string,
    examScheduleId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const target = await client.examSchedule.findUniqueOrThrow({ where: { id: examScheduleId } });

    const otherAssignments = await client.invigilationAssignment.findMany({
      where: {
        staffId,
        examScheduleId: { not: examScheduleId },
        // Same reasoning as TimetableSlotService.assertNoConflicts — a
        // REJECTED row must not permanently block its slot from reuse.
        approvalStatus: { not: TimetableApprovalStatus.REJECTED },
      },
      include: { examSchedule: true },
    });

    // A mixed-hall duty (ExamDayInvigilation) occupies the whole exam day.
    const hallDuty = await client.examDayInvigilation.findFirst({
      where: { staffId, date: target.date, approvalStatus: { not: TimetableApprovalStatus.REJECTED } },
    });
    if (hallDuty) {
      throw new BadRequestException("Staff member is already on hall invigilation duty on this date");
    }

    for (const assignment of otherAssignments) {
      if (assignment.examSchedule.date.getTime() !== target.date.getTime()) continue;
      // Concurrent papers in the SAME class arm (an options-column bundle in
      // a unified sitting) are one room, one invigilator — not a double-booking.
      if (assignment.examSchedule.classArmId === target.classArmId) continue;
      if (timeRangesOverlap(target.startTime, target.endTime, assignment.examSchedule.startTime, assignment.examSchedule.endTime)) {
        throw new BadRequestException(
          `Staff member is already invigilating another exam from ${assignment.examSchedule.startTime} to ${assignment.examSchedule.endTime} on this date`,
        );
      }
    }
  }

  /**
   * BUILD_PLAN.md §9 Step 6e: found during live verification — the CP-SAT
   * generator hard-enforces "a staff member holds at most one role per
   * exam" (invigilation.py's pairwise constraint), but the manual
   * update/swap paths had no equivalent check, so a grid edit could
   * silently put the same person in both LEAD and ASSISTANT for one exam.
   * assertNoConflicts alone doesn't catch this — it deliberately excludes
   * the target exam's own other role row (examScheduleId: {not:
   * examScheduleId}) since holding a role on this exam isn't itself a
   * conflict; only holding *both* roles on it is.
   */
  private async assertNotAlreadyOtherRole(
    staffId: string,
    examScheduleId: string,
    role: InvigilationRole,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const existing = await client.invigilationAssignment.findFirst({
      where: { examScheduleId, staffId, role: { not: role }, approvalStatus: { not: TimetableApprovalStatus.REJECTED } },
    });
    if (existing) {
      throw new BadRequestException("Staff member already holds the other invigilation role for this exam");
    }
  }

  // BUILD_PLAN.md §9 Step 6: same APPROVED-only default as
  // ExamScheduleService/TimetableSlotService.findAll. assessmentComponentId
  // (Step 6e) is a relation filter — InvigilationAssignment has no such
  // column of its own, only via examSchedule.assessmentComponentId — so the
  // grid can fetch a whole component's roster (every arm) in one call,
  // matching how the queue already groups INVIGILATION batches by that key.
  async findAll(
    filters: {
      examScheduleId?: string;
      staffId?: string;
      assessmentComponentId?: string;
      approvalStatus?: TimetableApprovalStatus;
    },
    user?: RequestUser,
  ) {
    const { assessmentComponentId, ...rest } = filters;
    // PRD §5 footnote split extended here: a Principal/Headteacher only sees
    // invigilation rows for exams in their own section.
    const categories = user ? resolvePrincipalHeadteacherCategories(user) : null;
    const examScheduleWhere: Prisma.ExamScheduleWhereInput = {};
    // Resolved to the component's whole exam sitting (e.g. JSS+SSS) —
    // generated and reviewed as one roster, so it's listed as one too.
    if (assessmentComponentId) {
      examScheduleWhere.assessmentComponentId = { in: (await resolveSitting(this.prisma, assessmentComponentId, { display: true })).componentIds };
    }
    if (categories) examScheduleWhere.classArm = { classLevel: { category: { in: categories } } };

    const rows = await this.prisma.invigilationAssignment.findMany({
      where: {
        ...rest,
        approvalStatus: filters.approvalStatus ?? TimetableApprovalStatus.APPROVED,
        examSchedule: Object.keys(examScheduleWhere).length > 0 ? examScheduleWhere : undefined,
      },
      include: {
        examSchedule: { include: { classArm: { include: { classLevel: { select: { name: true } } } }, subject: true } },
        staff: { include: { user: true } },
      },
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map((row) => ({
      ...row,
      examSchedule: { ...row.examSchedule, classArm: withDisplayName(row.examSchedule.classArm) },
    }));
  }

  // BUILD_PLAN.md §9 Step 6e: reassigning one fixed (examSchedule, role)
  // slot to a different staff member — a plain single-row update, no
  // uniqueness risk (examScheduleId/role never change).
  async update(id: string, dto: UpdateInvigilationAssignmentDto) {
    const existing = await this.prisma.invigilationAssignment.findUniqueOrThrow({ where: { id } });
    await assertInvigilationEligible(this.prisma, dto.staffId);
    await this.assertNoConflicts(dto.staffId, existing.examScheduleId);
    await this.assertNotAlreadyOtherRole(dto.staffId, existing.examScheduleId, existing.role);
    return this.prisma.invigilationAssignment.update({ where: { id }, data: { staffId: dto.staffId } });
  }

  /**
   * BUILD_PLAN.md §9 Step 6e: dragging one assignment's staff card onto
   * another's cell swaps their staffId values — neither row's own
   * (examScheduleId, role) identity changes, so the @@unique constraint is
   * never at risk. Transactional, not two independent PATCH calls: if the
   * second update failed after the first succeeded, one staff member would
   * end up double-booked and the other's slot vacated — a real,
   * hard-to-recover inconsistency a plain sequential-calls approach can't
   * rule out.
   */
  async swap(idA: string, idB: string) {
    return this.prisma.$transaction(async (tx) => {
      const [rowA, rowB] = await Promise.all([
        tx.invigilationAssignment.findUniqueOrThrow({ where: { id: idA } }),
        tx.invigilationAssignment.findUniqueOrThrow({ where: { id: idB } }),
      ]);
      await assertInvigilationEligible(tx, rowA.staffId);
      await assertInvigilationEligible(tx, rowB.staffId);
      await this.assertNoConflicts(rowB.staffId, rowA.examScheduleId, tx);
      await this.assertNoConflicts(rowA.staffId, rowB.examScheduleId, tx);
      await this.assertNotAlreadyOtherRole(rowB.staffId, rowA.examScheduleId, rowA.role, tx);
      await this.assertNotAlreadyOtherRole(rowA.staffId, rowB.examScheduleId, rowB.role, tx);
      await tx.invigilationAssignment.update({ where: { id: idA }, data: { staffId: rowB.staffId } });
      await tx.invigilationAssignment.update({ where: { id: idB }, data: { staffId: rowA.staffId } });
      return { a: idA, b: idB };
    });
  }

  /**
   * Multi-row reassign backing the day-grouped roster grid (one row per class
   * arm per exam day, covering every paper that arm sits). Writes first, then
   * re-checks each row against the post-write state inside the transaction —
   * checking up front would flag the group's own sibling rows (or, for a swap,
   * the rows about to change hands) as false conflicts.
   */
  async reassign(ids: string[], staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      await assertInvigilationEligible(tx, staffId);
      const rows = await tx.invigilationAssignment.findMany({ where: { id: { in: ids } } });
      if (rows.length !== new Set(ids).size) throw new BadRequestException("One or more invigilation assignments were not found");
      await tx.invigilationAssignment.updateMany({ where: { id: { in: ids } }, data: { staffId } });
      for (const row of rows) {
        await this.assertNoConflicts(staffId, row.examScheduleId, tx);
        await this.assertNotAlreadyOtherRole(staffId, row.examScheduleId, row.role, tx);
      }
      return { ids, staffId };
    });
  }

  async swapGroups(idsA: string[], idsB: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const [rowsA, rowsB] = await Promise.all([
        tx.invigilationAssignment.findMany({ where: { id: { in: idsA } } }),
        tx.invigilationAssignment.findMany({ where: { id: { in: idsB } } }),
      ]);
      if (rowsA.length !== new Set(idsA).size || rowsB.length !== new Set(idsB).size) {
        throw new BadRequestException("One or more invigilation assignments were not found");
      }
      const staffA = new Set(rowsA.map((r) => r.staffId));
      const staffB = new Set(rowsB.map((r) => r.staffId));
      if (staffA.size !== 1 || staffB.size !== 1) {
        throw new BadRequestException("Each side of a swap must currently be held by a single staff member");
      }
      const a = rowsA[0]!.staffId;
      const b = rowsB[0]!.staffId;
      await assertInvigilationEligible(tx, a);
      await assertInvigilationEligible(tx, b);
      await tx.invigilationAssignment.updateMany({ where: { id: { in: idsA } }, data: { staffId: b } });
      await tx.invigilationAssignment.updateMany({ where: { id: { in: idsB } }, data: { staffId: a } });
      for (const row of rowsA) {
        await this.assertNoConflicts(b, row.examScheduleId, tx);
        await this.assertNotAlreadyOtherRole(b, row.examScheduleId, row.role, tx);
      }
      for (const row of rowsB) {
        await this.assertNoConflicts(a, row.examScheduleId, tx);
        await this.assertNotAlreadyOtherRole(a, row.examScheduleId, row.role, tx);
      }
      return { idsA, idsB };
    });
  }

  /**
   * Downloadable roster for a sitting, grouped per exam day like the
   * on-screen grid — APPROVED rows only, through both findAll methods so the
   * same section scoping applies. Mixed-hall days list names only; per-class
   * days list each class arm with its invigilator(s).
   */
  async buildPdf(assessmentComponentId: string, user?: RequestUser): Promise<{ buffer: Buffer; filename: string }> {
    const [paperRows, hallRows, component, school] = await Promise.all([
      this.findAll({ assessmentComponentId }, user),
      this.examDayInvigilations.findAll({ assessmentComponentId }, user),
      this.prisma.assessmentComponent.findUniqueOrThrow({
        where: { id: assessmentComponentId },
        include: { term: { include: { academicSession: true } } },
      }),
      this.prisma.schoolProfile.findFirstOrThrow(),
    ]);

    const days = new Map<string, InvigilationPdfDay>();
    const dayFor = (date: Date) => {
      const key = date.toISOString().slice(0, 10);
      let day = days.get(key);
      if (!day) {
        day = { date: key, hall: [], classes: [] };
        days.set(key, day);
      }
      return day;
    };
    for (const row of hallRows) dayFor(row.date).hall.push(formatPersonName(row.staff.user));

    // (date, classArm) -> distinct holder names per role (normally one each).
    const groups = new Map<string, { day: InvigilationPdfDay; classArm: string; lead: Set<string>; assistant: Set<string> }>();
    for (const row of paperRows) {
      const day = dayFor(row.examSchedule.date);
      const key = `${day.date}|${row.examSchedule.classArmId}`;
      let group = groups.get(key);
      if (!group) {
        group = { day, classArm: row.examSchedule.classArm.displayName, lead: new Set(), assistant: new Set() };
        groups.set(key, group);
      }
      (row.role === InvigilationRole.LEAD ? group.lead : group.assistant).add(formatPersonName(row.staff.user));
    }
    for (const group of groups.values()) {
      group.day.classes.push({
        classArm: group.classArm,
        lead: [...group.lead].join(" / ") || "—",
        assistant: group.assistant.size > 0 ? [...group.assistant].join(" / ") : null,
      });
    }
    const sortedDays = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const day of sortedDays) {
      day.hall.sort((a, b) => a.localeCompare(b));
      day.classes.sort((a, b) => a.classArm.localeCompare(b.classArm, undefined, { numeric: true }));
    }

    const title = "Invigilation Roster";
    const subtitle = `${component.name}, ${component.term.name}, ${component.term.academicSession.name}`;
    const buffer = await renderInvigilationRosterPdf(title, subtitle, sortedDays, school.name);
    return { buffer, filename: `${pdfFileSlug(`invigilation-roster-${component.name}`)}.pdf` };
  }

  findExcludedStaffIds() {
    return findHardExcludedInvigilatorIds(this.prisma);
  }
}

/**
 * BUILD_PLAN.md §9 Step 6: read + approve/reject only, same "no manual CRUD
 * yet" precedent as ExamScheduleController. PRD footnote 4 states
 * invigilation-roster approval as Admin-only; per an explicit later
 * decision, Super-Admin is allowed too (see assertCanApprove below).
 */
@Controller("invigilation-assignments")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class InvigilationAssignmentController {
  constructor(private readonly service: InvigilationAssignmentService) {}

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("examScheduleId") examScheduleId?: string,
    @Query("staffId") staffId?: string,
    @Query("assessmentComponentId") assessmentComponentId?: string,
    @Query("approvalStatus") approvalStatus?: TimetableApprovalStatus,
  ) {
    // PRD FR6.7: invigilation rosters are visible to assigned staff/
    // Registrar/Super-Admin/Admin — never to students or parents, unlike
    // TimetableSlot/ExamSchedule which those two roles do get (scoped to
    // their own class/wards). A user who also holds STAFF (e.g. a teacher
    // who's separately a parent) still passes.
    this.assertNotStudentOrParent(user);
    if (approvalStatus && approvalStatus !== TimetableApprovalStatus.APPROVED) {
      this.assertCanManage(user);
    }
    return this.service.findAll({ examScheduleId, staffId, assessmentComponentId, approvalStatus }, user);
  }

  // Same visibility as the roster itself (staff/admins only, approved rows).
  @Get("pdf")
  async downloadPdf(@CurrentUser() user: RequestUser, @Query("assessmentComponentId") assessmentComponentId?: string) {
    this.assertNotStudentOrParent(user);
    if (!assessmentComponentId) throw new BadRequestException("assessmentComponentId is required");
    const { buffer, filename } = await this.service.buildPdf(assessmentComponentId, user);
    return new StreamableFile(buffer, { type: "application/pdf", disposition: `attachment; filename="${filename}"` });
  }

  // Staff the grid's pickers must hide — never eligible to invigilate
  // (Super-Admin, Bursar; see invigilation-eligibility.ts).
  @Get("excluded-staff")
  findExcludedStaff(@CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.findExcludedStaffIds();
  }

  // Declared before ":id" so Nest doesn't route "reassign"/"swap-groups" as an id.
  @Patch("reassign")
  @Audited("InvigilationAssignment")
  reassign(@Body() dto: ReassignInvigilationAssignmentsDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.reassign(dto.ids, dto.staffId);
  }

  @Patch("swap-groups")
  @Audited("InvigilationAssignment")
  swapGroups(@Body() dto: SwapInvigilationGroupsDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.swapGroups(dto.idsA, dto.idsB);
  }

  // BUILD_PLAN.md §9 Step 6e: reassign via the grid's inline Select.
  @Patch(":id")
  @Audited("InvigilationAssignment", "invigilationAssignment")
  update(@Param("id") id: string, @Body() dto: UpdateInvigilationAssignmentDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.update(id, dto);
  }

  // BUILD_PLAN.md §9 Step 6e: reassign via the grid's drag-and-drop.
  @Patch(":id/swap")
  @Audited("InvigilationAssignment", "invigilationAssignment")
  swap(@Param("id") id: string, @Body() dto: SwapInvigilationAssignmentDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.swap(id, dto.withId);
  }

  // BUILD_PLAN.md §9 Step 6e: same actor set as ExamScheduleController's
  // assertCanManage — editing/viewing a draft is broader than approving one.
  private assertCanManage(user: RequestUser) {
    const isAdmin = user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    const canManage =
      isAdmin ||
      user.assignmentTypes.includes("REGISTRAR") ||
      ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));
    if (!canManage) {
      throw new ForbiddenException("Insufficient permissions to manage invigilation assignments");
    }
  }

  // PRD FR6.7: a pure Student/Parent account (holding neither STAFF nor
  // ADMIN/SUPER_ADMIN) never sees this resource, regardless of
  // approvalStatus — unlike TimetableSlot/ExamSchedule's read endpoints,
  // which scope those two roles down to their own class/wards instead of
  // excluding them outright.
  private assertNotStudentOrParent(user: RequestUser) {
    const isStaffOrAdmin =
      user.roles.includes("STAFF") || user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN");
    if (!isStaffOrAdmin) {
      throw new ForbiddenException("Invigilation rosters are not visible to this account type");
    }
  }
}
