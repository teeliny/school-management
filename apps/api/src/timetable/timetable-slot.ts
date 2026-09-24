import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import {
  AssignmentType,
  ClassLevelCategory,
  ClassLevelCategoryGroup,
  DayOfWeek,
  Prisma,
  ScheduleScope,
  TimetableApprovalStatus,
  TimetableGeneratedBy,
} from "@prisma/client";
import {
  categoryToGroup,
  computePeriodTime,
  formatPersonName,
  normalizeSubjectName,
  parseSpecialPeriods,
  parseSubjectPeriodBlockCounts,
  timeRangesOverlap,
  type PeriodStructure,
} from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { RequestUser } from "../auth/jwt.strategy";
import { AbilityFactory } from "../casl/ability.factory";
import { withDisplayName } from "../academic-structure/class-arm";
import { resolvePrincipalHeadteacherCategories } from "../common/class-level-category-scope";
import { Audited } from "../audit/audited.decorator";
import { CreateTimetableSlotDto, UpdateTimetableSlotDto } from "./dto/timetable-slot.dto";
import { renderTimetablePdf, type TimetablePdfSlot } from "./timetable-pdf.util";

interface ConflictCheckInput {
  staffId: string;
  // Used two ways: (1) the elective-block exemption below — a same-subject
  // collision against a sibling arm of the same class level is allowed, not
  // flagged; (2) carried through to a conflict's warn log so it names what
  // the REJECTED row actually was. Optional since not every caller has both
  // on hand (e.g. ExamScheduleService's own reuse of the time-overlap
  // primitives doesn't go through this method at all) — omitting either
  // just falls back to the plain "any overlap for this staff = conflict"
  // check, same as before this exemption existed.
  subjectId?: string;
  classArmId?: string;
  venue?: string | null;
  dayOfWeek: DayOfWeek;
  academicSessionId: string;
  termId: string;
  startTime: string;
  endTime: string;
}

@Injectable()
export class TimetableSlotService {
  private readonly logger = new Logger(TimetableSlotService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD §3.8: "validated for teacher/venue double-booking conflicts at the
   * service layer regardless of origin" — a range comparison, not something
   * a DB unique constraint can express, so it lives here rather than as a
   * schema-level guarantee. `client` defaults to the injected PrismaService
   * but accepts a `$transaction` callback's client too — BUILD_PLAN.md §9
   * Step 2's callback controller reuses this as a final safety net while
   * batch-inserting AI-generated rows, and needs each check to see the
   * batch's own prior inserts, not just what's already committed.
   */
  async assertNoConflicts(
    input: ConflictCheckInput,
    excludeId?: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const shared = {
      dayOfWeek: input.dayOfWeek,
      academicSessionId: input.academicSessionId,
      termId: input.termId,
      id: excludeId ? { not: excludeId } : undefined,
      // A REJECTED slot isn't real/active — the whole point of rejecting a
      // generated draft is to free its teacher/venue back up for a retry.
      // Without this, a rejected row permanently "blocks" that same
      // staff/time forever, so regenerating after any rejection reliably
      // fails on the very slots the rejection was meant to clear.
      approvalStatus: { not: TimetableApprovalStatus.REJECTED },
    } as const;

    const staffSlots = await client.timetableSlot.findMany({
      // excludeFromStaffAvailability rows are deliberately kept on their own
      // arm's timetable but don't count as a real commitment for this staff
      // member anywhere else — see the schema field's own comment.
      where: { ...shared, staffId: input.staffId, excludeFromStaffAvailability: false },
    });
    for (const slot of staffSlots) {
      if (!timeRangesOverlap(input.startTime, input.endTime, slot.startTime, slot.endTime)) continue;

      // Elective-block / shared-specialist exemption: the SAME subject,
      // taught by the SAME staff member, already sitting in a sibling arm,
      // isn't a double-booking — it's an intentional "one teacher covers
      // several arms at one shared slot" pattern, granted via either of two
      // routes:
      //   1. Same class level — the PRD options-column concept (an
      //      elective's teacher covers every arm's students of ONE level at
      //      a shared slot), matching class_timetable.py's bundle logic.
      //   2. SUBJECT_MAX_CONCURRENT_ARMS > 1 for this subject — the
      //      whole-level-sync relaxation (Music/French's shared specialist
      //      combining UP TO N arms, which may span DIFFERENT class levels
      //      entirely, e.g. Basic 1 + Basic 4 — see
      //      class_timetable.py's staff_subject_keys constraint). Checked by
      //      subject NAME (SUBJECT_MAX_CONCURRENT_ARMS is keyed by
      //      Subject.name, same convention as every other subject-level
      //      SchedulingConstraint — the editor has no subjectId picker) and
      //      the GROUP both arms' class levels resolve to, since the
      //      constraint is scoped per ClassLevelCategoryGroup.
      // A different subject sharing this teacher (real double-booking, e.g.
      // the Agric teacher accidentally picked for a Food & Nutrition slot)
      // never matches either route and is still flagged as a real conflict.
      if (input.subjectId && input.classArmId && slot.subjectId === input.subjectId && slot.classArmId !== input.classArmId) {
        const [newArm, existingArm] = await Promise.all([
          client.classArm.findUnique({ where: { id: input.classArmId }, select: { classLevel: { select: { id: true, category: true } } } }),
          client.classArm.findUnique({ where: { id: slot.classArmId }, select: { classLevel: { select: { id: true, category: true } } } }),
        ]);
        if (newArm && existingArm) {
          if (newArm.classLevel.id === existingArm.classLevel.id) continue;
          if (await this.subjectAllowsConcurrentArms(input.subjectId, newArm.classLevel.category, client)) continue;
        }
      }

      void this.logStaffConflict(input, slot);
      throw new BadRequestException(
        `Teacher is already booked from ${slot.startTime} to ${slot.endTime} on this day`,
      );
    }

    if (input.venue) {
      const venueSlots = await client.timetableSlot.findMany({
        where: { ...shared, venue: input.venue },
      });
      for (const slot of venueSlots) {
        if (timeRangesOverlap(input.startTime, input.endTime, slot.startTime, slot.endTime)) {
          throw new BadRequestException(
            `Venue "${input.venue}" is already booked from ${slot.startTime} to ${slot.endTime} on this day`,
          );
        }
      }
    }
  }

  /**
   * SUBJECT_MAX_CONCURRENT_ARMS lookup for the cross-level shared-specialist
   * exemption above — true when this subject is explicitly configured (by
   * name, CLASS_TIMETABLE scope, the category's own group) to allow more
   * than one arm sharing a slot. Queried fresh per conflict rather than
   * cached: this only runs on the already-rare "same subject/staff,
   * different arm, overlapping time" path, not on every conflict check.
   */
  private async subjectAllowsConcurrentArms(
    subjectId: string,
    category: ClassLevelCategory,
    client: PrismaService | Prisma.TransactionClient,
  ): Promise<boolean> {
    const [subject, row] = await Promise.all([
      client.subject.findUnique({ where: { id: subjectId }, select: { name: true } }),
      client.schedulingConstraint.findFirst({
        where: {
          scope: ScheduleScope.CLASS_TIMETABLE,
          classLevelCategoryGroup: categoryToGroup(category),
          key: "SUBJECT_MAX_CONCURRENT_ARMS",
          isActive: true,
        },
      }),
    ]);
    if (!subject || !row) return false;
    const nameKey = normalizeSubjectName(subject.name);
    return parseSubjectPeriodBlockCounts(row.value).some(
      (entry) => normalizeSubjectName(entry.subjectName) === nameKey && entry.count > 1,
    );
  }

  /**
   * Best-effort diagnostic for a staff conflict — resolves the teacher's
   * name and both subjects' names/codes so a warn log names WHO and WHAT
   * collided (`this.timetableSlots.assertNoConflicts` is otherwise the only
   * place that knows both sides of the overlap; the BadRequestException it
   * throws right after this only carries the existing slot's time). Never
   * lets a lookup failure block the actual conflict rejection — logging is
   * strictly informational. Deliberately fire-and-forget (the caller doesn't
   * await this) and always reads via `this.prisma`, never a caller's `tx` —
   * a batch-insert conflict check runs inside an interactive transaction
   * with its own tight wall-clock budget (assertNoConflicts's own doc
   * comment), and this lookup has nothing to do with that transaction's
   * correctness, so it must never add to its elapsed time.
   */
  private async logStaffConflict(
    input: ConflictCheckInput,
    existingSlot: { subjectId: string; classArmId: string; dayOfWeek: DayOfWeek; startTime: string; endTime: string },
  ) {
    try {
      const [staff, newSubject, existingSubject] = await Promise.all([
        this.prisma.staffProfile.findUnique({ where: { id: input.staffId }, include: { user: true } }),
        input.subjectId ? this.prisma.subject.findUnique({ where: { id: input.subjectId } }) : null,
        this.prisma.subject.findUnique({ where: { id: existingSlot.subjectId } }),
      ]);
      const staffName = staff ? formatPersonName(staff.user) : input.staffId;
      this.logger.warn(
        `Timetable staff conflict — teacher "${staffName}" (${input.staffId}): new ` +
          `${input.dayOfWeek} ${input.startTime}-${input.endTime} slot wants subject ` +
          `"${newSubject?.name ?? input.subjectId ?? "unknown"}" (classArm ${input.classArmId ?? "n/a"}), ` +
          `but is already booked ${existingSlot.dayOfWeek} ${existingSlot.startTime}-${existingSlot.endTime} ` +
          `for subject "${existingSubject?.name ?? existingSlot.subjectId}" (classArm ${existingSlot.classArmId})`,
      );
    } catch (err) {
      this.logger.warn(`Timetable conflict logging failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Backstop for the web picker's group-subject flattening — a group subject
   * (isGroup) is never itself timetabled, only its childSubjects are (same
   * rule and same backstop as ScoreEntryService.enter).
   */
  private async assertNotGroupSubject(subjectId: string) {
    const subject = await this.prisma.subject.findUnique({ where: { id: subjectId }, select: { isGroup: true } });
    if (subject?.isGroup) {
      throw new BadRequestException("Cannot timetable a group subject — add a slot for one of its child subjects instead");
    }
  }

  async create(dto: CreateTimetableSlotDto, userId: string) {
    await this.assertNotGroupSubject(dto.subjectId);
    await this.assertNoConflicts(dto);
    return this.prisma.timetableSlot.create({
      data: {
        ...dto,
        generatedBy: TimetableGeneratedBy.MANUAL,
        approvalStatus: TimetableApprovalStatus.APPROVED,
        approvedByUserId: userId,
        approvedAt: new Date(),
      },
    });
  }

  async update(id: string, dto: UpdateTimetableSlotDto) {
    const existing = await this.prisma.timetableSlot.findUniqueOrThrow({ where: { id } });
    if (dto.subjectId && dto.subjectId !== existing.subjectId) await this.assertNotGroupSubject(dto.subjectId);
    await this.assertNoConflicts({ ...existing, ...dto }, id);
    return this.prisma.timetableSlot.update({ where: { id }, data: dto });
  }

  // A *pure* parent caller may only ever see their own wards' classes —
  // mirrors TermReportCardService.findForUser's PARENT branch (StudentGuardian
  // join to the wards' currentClassId). Returns `null` for "no scoping
  // needed" (any other caller, including a STAFF/ADMIN/SUPER_ADMIN user who
  // also happens to be a PARENT — e.g. a class teacher guardianing their own
  // child — since they're otherwise fully entitled to view any class's
  // approved timetable and shouldn't be fenced into just their ward's class)
  // so findAll can tell "unrestricted" apart from "scoped to zero classes."
  private async resolveParentScopedClassArmIds(user: RequestUser): Promise<string[] | null> {
    if (!user.roles.includes("PARENT")) return null;
    if (user.roles.includes("STAFF") || user.roles.includes("ADMIN") || user.roles.includes("SUPER_ADMIN")) return null;
    const parentProfile = await this.prisma.parentProfile.findUnique({ where: { userId: user.id } });
    if (!parentProfile) return [];
    const wards = await this.prisma.studentProfile.findMany({
      where: { guardians: { some: { parentId: parentProfile.id } } },
      select: { currentClassId: true },
    });
    return wards.map((w) => w.currentClassId).filter((id): id is string => Boolean(id));
  }

  // PRD §5 footnote 6: the whole-school "all classes" overview (no single
  // classArmId requested) scopes Principal/Vice Principal to JSS/SSS and
  // Headteacher to Creche/Nursery/Primary — Super-Admin/Admin/Registrar stay
  // unscoped. Vice Principal is included here (this is manual TimetableSlot
  // management, not the AI-scheduling domain it's excluded from) but not in
  // the exam-schedule.ts copy of this same method, which backs the
  // AI-scheduling-generated ExamSchedule instead. A request for one specific
  // class arm is checked separately, in findAll below
  // (assertClassArmInScope), rather than through this method.
  private async resolveCategoryGroupScopedClassArmIds(user: RequestUser): Promise<string[] | null> {
    const isPrincipal = user.assignmentTypes.includes("PRINCIPAL") || user.assignmentTypes.includes("VICE_PRINCIPAL");
    const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");
    if (!isPrincipal && !isHeadteacher) return null;
    if (user.roles.includes("SUPER_ADMIN") || user.assignmentTypes.includes("REGISTRAR")) return null;

    const allowedGroup = isPrincipal ? ClassLevelCategoryGroup.JSS_SSS : ClassLevelCategoryGroup.CRECHE_NURSERY_PRIMARY;
    const classArms = await this.prisma.classArm.findMany({
      select: { id: true, classLevel: { select: { category: true } } },
    });
    return classArms.filter((arm) => categoryToGroup(arm.classLevel.category) === allowedGroup).map((arm) => arm.id);
  }

  async findAll(
    filters: {
      classArmId?: string;
      staffId?: string;
      academicSessionId?: string;
      termId?: string;
      approvalStatus?: TimetableApprovalStatus;
    },
    user?: RequestUser,
  ) {
    let classArmWhere: Prisma.TimetableSlotWhereInput["classArmId"] = filters.classArmId;

    if (user) {
      const parentScoped = await this.resolveParentScopedClassArmIds(user);
      if (parentScoped !== null) {
        if (filters.classArmId) {
          if (!parentScoped.includes(filters.classArmId)) return [];
        } else if (parentScoped.length === 0) {
          return [];
        } else {
          classArmWhere = { in: parentScoped };
        }
      } else if (!filters.classArmId) {
        const groupScoped = await this.resolveCategoryGroupScopedClassArmIds(user);
        if (groupScoped !== null) {
          if (groupScoped.length === 0) return [];
          classArmWhere = { in: groupScoped };
        }
      } else {
        // A specific classArmId was requested — check it falls within a
        // Principal/Headteacher's own section (the whole-school overview
        // above already handles the no-classArmId case).
        const categories = resolvePrincipalHeadteacherCategories(user);
        if (categories) {
          const arm = await this.prisma.classArm.findUnique({
            where: { id: filters.classArmId },
            select: { classLevel: { select: { category: true } } },
          });
          if (!arm || !categories.includes(arm.classLevel.category)) return [];
        }
      }
    }

    const rows = await this.prisma.timetableSlot.findMany({
      where: {
        staffId: filters.staffId,
        academicSessionId: filters.academicSessionId,
        termId: filters.termId,
        classArmId: classArmWhere,
        approvalStatus: filters.approvalStatus ?? TimetableApprovalStatus.APPROVED,
      },
      include: {
        classArm: { include: { classLevel: { select: { name: true } } } },
        subject: true,
        staff: { include: { user: true } },
      },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });
    // withDisplayName (academic-structure/class-arm.ts) is the one place
    // "{ClassLevel.name} {ClassArm.name}" is formatted — reused here so the
    // approvals queue renders the same "JSS 1 DIAMOND" shape the class-arm
    // dropdowns already use, instead of re-deriving it client-side.
    return rows.map((row) => ({ ...row, classArm: withDisplayName(row.classArm) }));
  }

  /**
   * The manual "Add a slot" form's Teacher picker used to list every staff
   * member in the school, unfiltered — nothing stopped picking a teacher who
   * isn't even assigned to the subject being scheduled (the exact mistake
   * that produced a "Teacher is already booked" conflict against that
   * teacher's OWN unrelated class, not the subject being added at all).
   * Scoped to active SUBJECT_TEACHER assignments for this subject, narrowed
   * further to `classArmIds` when the caller has any selected (empty means
   * "not narrowed yet" — every arm's assignment for this subject still
   * counts, since the multi-arm-select flow may not have a selection until
   * the user makes one).
   */
  async findEligibleTeachers(subjectId: string, classArmIds: string[], academicSessionId: string) {
    const rows = await this.prisma.staffAssignment.findMany({
      where: {
        assignmentType: AssignmentType.SUBJECT_TEACHER,
        subjectId,
        academicSessionId,
        isActive: true,
        ...(classArmIds.length > 0 ? { classArmId: { in: classArmIds } } : {}),
      },
      include: { staff: { include: { user: { select: { firstName: true, lastName: true } } } } },
      distinct: ["staffId"],
    });
    return rows.map((r) => ({ id: r.staffId, user: r.staff.user }));
  }

  findOne(id: string) {
    return this.prisma.timetableSlot.findUniqueOrThrow({ where: { id } });
  }

  remove(id: string) {
    return this.prisma.timetableSlot.delete({ where: { id } });
  }

  /**
   * Same period-structure resolution as apps/worker's scheduling-solve-
   * dispatch.processor.ts's resolvePeriodStructure (and apps/web's
   * usePeriodStructure hook) — duplicated, not shared, same cross-process-
   * boundary reasoning as every other worker/api duplicate in this codebase
   * (e.g. BroadsheetService's reimplementation of computeAnnualSummary).
   * Unlike the worker's version, this returns null rather than a NaN-filled
   * PeriodStructure when the six required keys aren't all configured for
   * this group — the worker's copy feeds a solver that would just reject
   * bad input, but this feeds pseudo-slot clock times shown directly on a
   * document a parent/teacher reads, so silently computing garbage times
   * would be worse than just skipping activity periods for a school that
   * hasn't set up a period structure yet.
   */
  private async resolvePeriodStructure(group: ClassLevelCategoryGroup): Promise<PeriodStructure | null> {
    const rows = await this.prisma.schedulingConstraint.findMany({
      where: { scope: ScheduleScope.CLASS_TIMETABLE, classLevelCategoryGroup: group, isActive: true },
    });
    const get = (key: string): unknown => rows.find((r) => r.key === key)?.value;
    const requiredKeys = [
      "PERIODS_PER_DAY",
      "PERIOD_DURATION_MINUTES",
      "SCHOOL_DAY_START_TIME",
      "BREAK_AFTER_PERIOD",
      "BREAK_DURATION_MINUTES",
      "FRIDAY_BREAK_DURATION_MINUTES",
    ];
    if (!requiredKeys.every((key) => get(key) !== undefined)) return null;

    const periodsPerDay = Number(get("PERIODS_PER_DAY"));
    const periodDurationMinutes = Number(get("PERIOD_DURATION_MINUTES"));
    const shortBreakAfterPeriod = get("SHORT_BREAK_AFTER_PERIOD");
    const fridayPeriodsPerDay = get("FRIDAY_PERIODS_PER_DAY");
    return {
      periodsPerDay,
      periodDurationMinutes,
      schoolDayStartTime: String(get("SCHOOL_DAY_START_TIME")),
      breakAfterPeriod: Number(get("BREAK_AFTER_PERIOD")),
      breakDurationMinutes: Number(get("BREAK_DURATION_MINUTES")),
      fridayBreakDurationMinutes: Number(get("FRIDAY_BREAK_DURATION_MINUTES")),
      shortBreakAfterPeriod: shortBreakAfterPeriod === undefined ? periodsPerDay : Number(shortBreakAfterPeriod),
      shortBreakDurationMinutes: Number(get("SHORT_BREAK_DURATION_MINUTES") ?? 0),
      fridayPeriodDurationMinutes: Number(get("FRIDAY_PERIOD_DURATION_MINUTES") ?? periodDurationMinutes),
      fridayPeriodsPerDay: fridayPeriodsPerDay === undefined ? periodsPerDay : Number(fridayPeriodsPerDay),
    };
  }

  /**
   * School-wide fixed non-subject blocks — CLASS_TIMETABLE's SPECIAL_PERIODS
   * (e.g. Wednesday Sports/Extra-Curricular) plus Friday's trailing activity
   * (e.g. "Religious activities" after the last real period) — same for
   * every class arm/teacher in this category group. Rendered as extra
   * TimetablePdfSlot rows (isActivity: true) rather than pulled from
   * TimetableSlot, since no real row is ever created for these: the whole
   * point of SPECIAL_PERIODS is blocking the AI solver from scheduling a
   * real subject there (apps/worker's resolveSpecialPeriodBlocks). Only
   * used for the PDF download — the on-screen grid already renders these
   * itself, client-side (apps/web's useSpecialPeriods).
   */
  private async resolveActivitySlots(group: ClassLevelCategoryGroup): Promise<TimetablePdfSlot[]> {
    const structure = await this.resolvePeriodStructure(group);
    if (!structure) return [];

    const rows = await this.prisma.schedulingConstraint.findMany({
      where: {
        scope: ScheduleScope.CLASS_TIMETABLE,
        classLevelCategoryGroup: group,
        isActive: true,
        key: { in: ["SPECIAL_PERIODS", "FRIDAY_TRAILING_ACTIVITY_LABEL", "FRIDAY_TRAILING_ACTIVITY_END_TIME"] },
      },
    });
    const get = (key: string): unknown => rows.find((r) => r.key === key)?.value;

    const activitySlots: TimetablePdfSlot[] = [];
    for (const special of parseSpecialPeriods(get("SPECIAL_PERIODS"))) {
      // One pseudo-slot PER period in the range, not one merged block
      // spanning start-to-end — a 2-period block (e.g. "WEDNESDAY:1-2:Sports")
      // must land in the SAME two period columns every other subject on that
      // day uses, not introduce its own wider, one-off column that doesn't
      // line up with the rest of the grid (which is what a single
      // period-1-start to period-2-end range produced before this).
      const maxPeriodForDay = special.day === DayOfWeek.FRIDAY ? structure.fridayPeriodsPerDay : structure.periodsPerDay;
      for (let period = special.startPeriod; period <= special.endPeriod; period++) {
        // This day doesn't run that many periods (most relevant for
        // Friday's shorter day) — same as the on-screen grid, which never
        // renders a column past a day's own real period count.
        if (period > maxPeriodForDay) break;
        const { startTime, endTime } = computePeriodTime(structure, special.day, period);
        activitySlots.push({ dayOfWeek: special.day, startTime, endTime, lines: [special.label, "School activity"], isActivity: true });
      }
    }

    const trailingLabel = get("FRIDAY_TRAILING_ACTIVITY_LABEL");
    const trailingEndTime = get("FRIDAY_TRAILING_ACTIVITY_END_TIME");
    if (typeof trailingLabel === "string" && typeof trailingEndTime === "string") {
      const trailingStartTime = computePeriodTime(structure, DayOfWeek.FRIDAY, structure.fridayPeriodsPerDay).endTime;
      if (trailingStartTime < trailingEndTime) {
        activitySlots.push({
          dayOfWeek: DayOfWeek.FRIDAY,
          startTime: trailingStartTime,
          endTime: trailingEndTime,
          lines: [trailingLabel, "School activity"],
          isActivity: true,
        });
      }
    }

    return activitySlots;
  }

  /**
   * Blank placeholder entries for every period this group's PeriodStructure
   * actually defines (1..periodsPerDay Monday-Thursday, 1..fridayPeriodsPerDay
   * Friday). Without these, a day/period with neither a real TimetableSlot
   * nor a SPECIAL_PERIODS block has no entry in `slots` at all, so
   * buildColumns (which only ever sees the time ranges actually present)
   * silently drops that period's column from the grid rather than showing
   * it as an empty bordered cell the way every other unused-but-columned
   * period does — most visible on Friday, whose shorter real slot count
   * means it's much more likely than a weekday to have periods nothing is
   * scheduled in at all. `lines: []` renders as a bordered cell with no
   * text (renderTimetablePdf treats an empty first line the same as "no
   * slot" for content purposes). Weekday fillers are all tagged MONDAY
   * rather than one set per weekday — renderTimetablePdf draws a period's
   * border off the shared column set itself, not off whether each
   * individual day's own slots happen to include an entry at that exact
   * time, so establishing the column at all is enough; every other weekday
   * gets the same bordered cell for free once the column exists (same
   * "compute weekday times off Monday" convention apps/web's own
   * buildPeriodColumns already uses).
   */
  private buildFullGridFillerSlots(structure: PeriodStructure): TimetablePdfSlot[] {
    const filler: TimetablePdfSlot[] = [];
    for (let period = 1; period <= structure.periodsPerDay; period++) {
      const { startTime, endTime } = computePeriodTime(structure, DayOfWeek.MONDAY, period);
      filler.push({ dayOfWeek: DayOfWeek.MONDAY, startTime, endTime, lines: [] });
    }
    for (let period = 1; period <= structure.fridayPeriodsPerDay; period++) {
      const { startTime, endTime } = computePeriodTime(structure, DayOfWeek.FRIDAY, period);
      filler.push({ dayOfWeek: DayOfWeek.FRIDAY, startTime, endTime, lines: [] });
    }
    return filler;
  }

  /**
   * One break pseudo-slot per gap between consecutive periods (long break,
   * weekday short break) — the gap is measured as "this period's end to the
   * next period's start", so a long and short break configured at the same
   * point stack into one column, exactly as computePeriodTime stacks them.
   * Same column rule as apps/web's buildPeriodColumns (no break column after
   * a day's last period). Weekday breaks are tagged MONDAY only, Friday's
   * FRIDAY — renderTimetablePdf draws a break column's "BREAK" cell on every
   * row sharing that column set, same reasoning as buildFullGridFillerSlots.
   */
  private buildBreakSlots(structure: PeriodStructure): TimetablePdfSlot[] {
    const breaks: TimetablePdfSlot[] = [];
    const days = [
      { day: DayOfWeek.MONDAY, periods: structure.periodsPerDay },
      { day: DayOfWeek.FRIDAY, periods: structure.fridayPeriodsPerDay },
    ];
    for (const { day, periods } of days) {
      for (let period = 1; period < periods; period++) {
        const startTime = computePeriodTime(structure, day, period).endTime;
        const endTime = computePeriodTime(structure, day, period + 1).startTime;
        if (startTime < endTime) breaks.push({ dayOfWeek: day, startTime, endTime, lines: [], isBreak: true });
      }
    }
    return breaks;
  }

  /**
   * A4-landscape PDF of the same rows `findAll` would show on screen —
   * reuses that method verbatim (including its parent/category-group
   * scoping) so a download never exposes anything the requester couldn't
   * already see in the grid. `classArmId` set renders that one class's
   * timetable (each cell: subject + teacher); `staffId` set with no
   * `classArmId` renders that teacher's own personal timetable across every
   * class they teach (each cell: subject + class arm) — the two only ever
   * differ in which name goes on the second line of each cell, since the
   * first line (subject) is the same in both.
   */
  async buildPdf(
    filters: { classArmId?: string; staffId?: string; academicSessionId: string; termId: string },
    user?: RequestUser,
  ): Promise<Buffer> {
    const rows = await this.findAll(filters, user);
    const term = await this.prisma.term.findUniqueOrThrow({
      where: { id: filters.termId },
      include: { academicSession: true },
    });
    const school = await this.prisma.schoolProfile.findFirstOrThrow();

    let title = "Timetable";
    // Which category group(s) to pull activity periods (Sports, Fellowship,
    // ...) for — resolved from the actual class arm(s) involved, not
    // assumed, since a class-arm view is exactly one group but a teacher's
    // personal timetable could in principle span more than one (nothing
    // stops one teacher covering both JSS/SSS and Creche/Nursery/Primary).
    const groups = new Set<ClassLevelCategoryGroup>();
    if (filters.classArmId) {
      const arm = await this.prisma.classArm.findUnique({
        where: { id: filters.classArmId },
        include: { classLevel: { select: { name: true, category: true } } },
      });
      if (arm) {
        title = withDisplayName(arm).displayName;
        groups.add(categoryToGroup(arm.classLevel.category));
      }
    } else if (filters.staffId) {
      const staff = await this.prisma.staffProfile.findUnique({ where: { id: filters.staffId }, include: { user: true } });
      if (staff) title = `${formatPersonName(staff.user)} — Personal Timetable`;
      const classArmIds = [...new Set(rows.map((row) => row.classArmId))];
      if (classArmIds.length > 0) {
        const arms = await this.prisma.classArm.findMany({
          where: { id: { in: classArmIds } },
          select: { classLevel: { select: { category: true } } },
        });
        for (const arm of arms) groups.add(categoryToGroup(arm.classLevel.category));
      }
    }

    const subtitle = `${term.name}, ${term.academicSession.name}`;
    const slots: TimetablePdfSlot[] = rows.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      // Full subject name, not the internal code (SSS_GOVT, SSS_F/N, ...) —
      // a printed/downloaded timetable is read by people outside the admin
      // tooling (students, parents), who have no reason to know the code
      // vocabulary. Shown in full, wrapping onto as many lines as needed
      // (renderTimetablePdf never truncates).
      lines: filters.classArmId
        ? [row.subject.name.trim(), formatPersonName(row.staff.user)]
        : [row.subject.name.trim(), row.classArm.displayName],
    }));

    // Merged in after the real slots — deduped by day/time/label since a
    // teacher spanning more than one category group could otherwise get the
    // same activity twice if both groups happen to share an identical
    // SPECIAL_PERIODS entry.
    const seenActivityKeys = new Set<string>();
    for (const group of groups) {
      for (const activitySlot of await this.resolveActivitySlots(group)) {
        const key = `${activitySlot.dayOfWeek}|${activitySlot.startTime}|${activitySlot.endTime}|${activitySlot.lines[0]}`;
        if (seenActivityKeys.has(key)) continue;
        seenActivityKeys.add(key);
        slots.push(activitySlot);
      }
    }

    // Fills in every configured-but-otherwise-empty period so it still gets
    // its own bordered column, exactly like an empty period that DOES share
    // a time with something scheduled elsewhere in the week already does.
    // Only attempted for exactly one category group — a teacher spanning
    // more than one (each with its own, potentially incompatible, period
    // structure) falls back to the current data-derived columns rather than
    // guessing which group's grid should "win" the page.
    if (groups.size === 1) {
      const structure = await this.resolvePeriodStructure([...groups][0]!);
      if (structure) {
        const existingKeys = new Set(slots.map((s) => `${s.dayOfWeek}|${s.startTime}|${s.endTime}`));
        for (const filler of [...this.buildFullGridFillerSlots(structure), ...this.buildBreakSlots(structure)]) {
          const key = `${filler.dayOfWeek}|${filler.startTime}|${filler.endTime}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          slots.push(filler);
        }
      }
    }

    return renderTimetablePdf(title, subtitle, slots, school.name);
  }
}

@Controller("timetable-slots")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class TimetableSlotController {
  constructor(
    private readonly service: TimetableSlotService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  @Post()
  @Audited("TimetableSlot")
  create(@Body() dto: CreateTimetableSlotDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.create(dto, user.id);
  }

  // Defaults to APPROVED-only when approvalStatus is omitted — a
  // PENDING_REVIEW/DRAFT/REJECTED row is AI-generated-but-not-yet-published
  // (or explicitly rejected) draft state, FR6.5's "not visible to staff,
  // students, or parents until approved." Requesting anything else requires
  // the same manage-check used for create/update/delete, reusing existing
  // CASL infra rather than adding a new Subject just for this filter.
  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
    @Query("classArmId") classArmId?: string,
    @Query("staffId") staffId?: string,
    @Query("academicSessionId") academicSessionId?: string,
    @Query("termId") termId?: string,
    @Query("approvalStatus") approvalStatus?: TimetableApprovalStatus,
  ) {
    if (approvalStatus && approvalStatus !== TimetableApprovalStatus.APPROVED) {
      this.assertCanManage(user);
    }
    return this.service.findAll({ classArmId, staffId, academicSessionId, termId, approvalStatus }, user);
  }

  // Declared before ":id" — Nest matches routes in order, and ":id" would
  // otherwise swallow this literal path as id="eligible-teachers". Gated by
  // the same assertCanManage as create/update/delete (not a separate CASL
  // Subject) so it's available to exactly whoever "Add a slot" already is —
  // Registrar/Principal/Headteacher included, unlike GET /staff-assignments
  // (manage StaffAssignment is Admin/Super-Admin only, which would 403 them).
  @Get("eligible-teachers")
  findEligibleTeachers(
    @CurrentUser() user: RequestUser,
    @Query("subjectId") subjectId?: string,
    @Query("classArmId") classArmId?: string | string[],
    @Query("academicSessionId") academicSessionId?: string,
  ) {
    this.assertCanManage(user);
    if (!subjectId || !academicSessionId) return [];
    const classArmIds = Array.isArray(classArmId) ? classArmId : classArmId ? [classArmId] : [];
    return this.service.findEligibleTeachers(subjectId, classArmIds, academicSessionId);
  }

  // Also declared before ":id", same routing reason as "eligible-teachers"
  // above. No assertCanManage here — this streams exactly the APPROVED rows
  // `findAll` would already show this user on screen (same method, same
  // scoping), so anyone who can view a grid can download it; there's nothing
  // this exposes beyond that.
  @Get("pdf")
  async downloadPdf(
    @CurrentUser() user: RequestUser,
    @Query("classArmId") classArmId?: string,
    @Query("staffId") staffId?: string,
    @Query("academicSessionId") academicSessionId?: string,
    @Query("termId") termId?: string,
  ) {
    if (!academicSessionId || !termId || (!classArmId && !staffId)) {
      throw new BadRequestException("academicSessionId, termId, and either classArmId or staffId are required");
    }
    const buffer = await this.service.buildPdf({ classArmId, staffId, academicSessionId, termId }, user);
    return new StreamableFile(buffer, {
      type: "application/pdf",
      disposition: `attachment; filename="timetable.pdf"`,
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  @Audited("TimetableSlot", "timetableSlot")
  update(@Param("id") id: string, @Body() dto: UpdateTimetableSlotDto, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Audited("TimetableSlot", "timetableSlot")
  remove(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    this.assertCanManage(user);
    return this.service.remove(id);
  }

  // Registrar is a StaffAssignment.assignmentType, not a Role — this attribute
  // check is on the *acting user*, not the resource, so it's not expressible
  // as a @CheckPolicies decorator the way resource-scoped rules are.
  private assertCanManage(user: RequestUser) {
    const ability = this.abilityFactory.createForUser(user);
    if (!ability.can("manage", "TimetableSlot")) {
      throw new ForbiddenException("Insufficient permissions to manage the timetable");
    }
  }
}
