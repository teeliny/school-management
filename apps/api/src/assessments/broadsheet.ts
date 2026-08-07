import { BadRequestException, Controller, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import type { ClassLevelCategory } from "@prisma/client";
import { findGradeScaleMatch, type GradeScaleRow } from "@school/types";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PoliciesGuard } from "../casl/policies.guard";
import { CheckPolicies } from "../casl/check-policies.decorator";

interface RankableResult {
  id: string;
  totalScore: number;
}

// Same competition-ranking algorithm as apps/worker/src/subject-term-result/
// position-ranking.util.ts's assignPositions — duplicated rather than
// shared (same "no shared package worth the coupling for one small pure
// function" precedent as parseCorsOrigins, CLAUDE.md) since this is a fresh,
// request-time ranking over whatever scope the caller asked for (the whole
// ClassLevel by default), never a read of the worker's stored per-ClassArm
// SubjectTermResult.position.
function assignPositions(results: RankableResult[]): Map<string, number> {
  const sorted = [...results].sort((a, b) => b.totalScore - a.totalScore);
  const positions = new Map<string, number>();

  let rank = 0;
  let previousScore: number | null = null;
  let processed = 0;

  for (const result of sorted) {
    processed += 1;
    if (previousScore === null || result.totalScore !== previousScore) {
      rank = processed;
      previousScore = result.totalScore;
    }
    positions.set(result.id, rank);
  }

  return positions;
}

function sortValue(row: BroadsheetRow, sortBy: string): number | null {
  if (sortBy === "average") return row.overallAverage;
  if (sortBy === "position") return row.overallPosition;
  return row.subjects.find((s) => s.subjectId === sortBy)?.totalScore ?? null;
}

// Sorting by a subject/average/position column happens here, not on the
// client — the whole point of scoping to a ClassLevel is comparing students
// across every arm at once, so the ranked order has to be computed
// server-side over the full population before pagination slices it, the
// same "position is never just a read of the stored per-arm value" reason
// assignPositions above is its own fresh computation.
function sortRows(rows: BroadsheetRow[], sortBy: string, dir: "asc" | "desc"): BroadsheetRow[] {
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sortBy);
    const bv = sortValue(b, sortBy);
    // Blank cells always sort to the bottom, regardless of direction.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return dir === "asc" ? av - bv : bv - av;
  });
}

// A subject (or the overall row) with nothing scored is excluded from
// averaging entirely rather than counted as 0 — same "missing term isn't
// zero" rule apps/worker's SubjectTermResultService.computeAnnualSummary
// already applies, extended here to also cover a single term's own subject
// list (a subject the student isn't enrolled in / has no result for yet
// must not drag their term average down either).
function average(scores: number[]): number | null {
  return scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null;
}

export interface BroadsheetSubjectCell {
  subjectId: string;
  totalScore: number | null;
  grade: string | null;
  position: number | null;
}

export interface BroadsheetRow {
  studentId: string;
  admissionNumber: string;
  studentName: string;
  classArmId: string;
  classArmName: string;
  subjects: BroadsheetSubjectCell[];
  overallAverage: number | null;
  overallGrade: string | null;
  overallPosition: number | null;
}

export interface BroadsheetResponse {
  mode: "TERM" | "SESSION";
  termId: string | null;
  academicSessionId: string;
  periodLabel: string;
  classLevelId: string;
  classLevelName: string;
  scope: "CLASS_LEVEL" | "CLASS_ARM";
  classArmId: string | null;
  subjectColumns: { id: string; name: string }[];
  rows: BroadsheetRow[];
  // Count of every student in scope, before `skip`/`take` slice the page —
  // same "row count independent of the page returned" contract as
  // StudentService.findAllForUser's `{ data, total }`.
  total: number;
}

/**
 * Whole-class grid (every student x every subject the class group is
 * offered) — the "broadsheet" a Nigerian school's paper mark sheet
 * corresponds to. Two time scopes: TERM (one term's own scores) or SESSION
 * ("Overall" — every subject cell is that student's average across
 * whichever terms in the session actually have a score for it, same
 * missing-term-excluded rule as computeAnnualSummary). Class scope is
 * separate from time scope: ClassLevel by default (every arm under it
 * combined, e.g. all of "JSS 1" across Diamond + Jacinth), with an explicit
 * classArmId narrowing to a single arm instead.
 *
 * Position — both per-subject and overall — is computed fresh across
 * whichever population was requested; it's intentionally never a read of
 * SubjectTermResult's own stored `position` column, which the worker always
 * computes per-ClassArm-per-term regardless of what this view is scoped to
 * (see apps/worker/src/subject-term-result/subject-term-result.service.ts).
 * Read access is Super-Admin/Principal/Headteacher only (CaslAbilityFactory)
 * — deliberately not Admin, unlike almost everything else in this module.
 */
@Injectable()
export class BroadsheetService {
  constructor(private readonly prisma: PrismaService) {}

  async build(params: {
    termId?: string;
    academicSessionId?: string;
    classLevelId?: string;
    classArmId?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    skip?: number;
    take?: number;
  }): Promise<BroadsheetResponse> {
    if (!params.classLevelId && !params.classArmId) {
      throw new BadRequestException("classLevelId or classArmId is required");
    }
    if (!params.termId && !params.academicSessionId) {
      throw new BadRequestException("termId or academicSessionId is required");
    }
    if (params.termId && params.academicSessionId) {
      throw new BadRequestException("Provide either termId or academicSessionId, not both");
    }

    const mode: "TERM" | "SESSION" = params.termId ? "TERM" : "SESSION";
    let termIds: string[];
    let academicSessionId: string;
    let periodLabel: string;

    if (params.termId) {
      const term = await this.prisma.term.findUniqueOrThrow({ where: { id: params.termId } });
      termIds = [term.id];
      academicSessionId = term.academicSessionId;
      periodLabel = term.name;
    } else {
      const session = await this.prisma.academicSession.findUniqueOrThrow({ where: { id: params.academicSessionId } });
      const terms = await this.prisma.term.findMany({ where: { academicSessionId: session.id } });
      termIds = terms.map((t) => t.id);
      academicSessionId = session.id;
      periodLabel = `${session.name} — Overall`;
    }

    let classLevel: { id: string; name: string; category: ClassLevelCategory };
    let classArms: { id: string; name: string }[];
    let scope: "CLASS_LEVEL" | "CLASS_ARM";

    if (params.classLevelId) {
      classLevel = await this.prisma.classLevel.findUniqueOrThrow({ where: { id: params.classLevelId } });
      classArms = await this.prisma.classArm.findMany({
        where: { classLevelId: classLevel.id, academicSessionId },
        select: { id: true, name: true },
      });
      scope = "CLASS_LEVEL";
    } else {
      const arm = await this.prisma.classArm.findUniqueOrThrow({
        where: { id: params.classArmId },
        include: { classLevel: true },
      });
      classLevel = arm.classLevel;
      classArms = [{ id: arm.id, name: arm.name }];
      scope = "CLASS_ARM";
    }

    const classArmIds = classArms.map((a) => a.id);
    const armById = new Map(classArms.map((a) => [a.id, a]));

    const emptyResponse: BroadsheetResponse = {
      mode,
      termId: params.termId ?? null,
      academicSessionId,
      periodLabel,
      classLevelId: classLevel.id,
      classLevelName: classLevel.name,
      scope,
      classArmId: scope === "CLASS_ARM" ? classArmIds[0]! : null,
      subjectColumns: [],
      rows: [],
      total: 0,
    };
    if (classArmIds.length === 0) return emptyResponse;

    // Columns are every subject catalogued for this class group (PRD §3.3
    // ClassSubject) — ClassSubject.subjectId is always the group parent or
    // a plain subject, never a child, so this is already "reportable" scope
    // with no extra parentSubjectId filter needed (same as report-card.
    // processor.ts's reportableResults, just derived from the other side).
    const classSubjects = await this.prisma.classSubject.findMany({
      where: { classLevelCategory: classLevel.category },
      include: { subject: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    const subjectColumns = classSubjects.map((cs) => ({ id: cs.subject.id, name: cs.subject.name }));
    if (subjectColumns.length === 0) return emptyResponse;

    const students = await this.prisma.studentProfile.findMany({
      where: { currentClassId: { in: classArmIds } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { admissionNumber: "asc" },
    });

    // In SESSION mode this can hold several rows per (student, subject) —
    // one per term that has a result — which the cell computation below
    // averages down to one figure per the missing-term-excluded rule.
    const results = await this.prisma.subjectTermResult.findMany({
      where: {
        termId: { in: termIds },
        classArmId: { in: classArmIds },
        subjectId: { in: subjectColumns.map((s) => s.id) },
      },
    });

    const gradeScaleRows = await this.prisma.gradeScale.findMany();
    const gradeScales: GradeScaleRow[] = gradeScaleRows.map((s) => ({
      minScore: Number(s.minScore),
      maxScore: Number(s.maxScore),
      grade: s.grade,
      remark: s.remark,
    }));

    // studentId -> subjectId -> every scored totalScore found (1 row in TERM
    // mode, 0-N in SESSION mode).
    const scoresByStudentSubject = new Map<string, Map<string, number[]>>();
    for (const result of results) {
      const bySubject = scoresByStudentSubject.get(result.studentId) ?? new Map<string, number[]>();
      const scores = bySubject.get(result.subjectId) ?? [];
      scores.push(Number(result.totalScore));
      bySubject.set(result.subjectId, scores);
      scoresByStudentSubject.set(result.studentId, bySubject);
    }

    // Cell totals — averaged across whatever terms actually have a score —
    // computed once per (student, subject) up front so both the per-subject
    // ranking below and the per-student row can read the same figure.
    const cellTotalByStudentSubject = new Map<string, Map<string, number>>();
    for (const [studentId, bySubject] of scoresByStudentSubject) {
      const cellTotals = new Map<string, number>();
      for (const [subjectId, scores] of bySubject) {
        const avg = average(scores);
        if (avg !== null) cellTotals.set(subjectId, avg);
      }
      cellTotalByStudentSubject.set(studentId, cellTotals);
    }

    const positionsBySubject = new Map<string, Map<string, number>>();
    for (const column of subjectColumns) {
      const rankable: RankableResult[] = [];
      for (const [studentId, cellTotals] of cellTotalByStudentSubject) {
        const total = cellTotals.get(column.id);
        if (total !== undefined) rankable.push({ id: studentId, totalScore: total });
      }
      positionsBySubject.set(column.id, assignPositions(rankable));
    }

    const overallRankable: RankableResult[] = [];
    const rows: BroadsheetRow[] = students.map((student) => {
      const cellTotals = cellTotalByStudentSubject.get(student.id);
      const subjects: BroadsheetSubjectCell[] = subjectColumns.map((column) => {
        const totalScore = cellTotals?.get(column.id);
        if (totalScore === undefined) return { subjectId: column.id, totalScore: null, grade: null, position: null };
        return {
          subjectId: column.id,
          totalScore,
          grade: findGradeScaleMatch(gradeScales, totalScore).grade,
          position: positionsBySubject.get(column.id)?.get(student.id) ?? null,
        };
      });

      const overallAverage = average(subjects.map((s) => s.totalScore).filter((s): s is number => s !== null));
      if (overallAverage !== null) overallRankable.push({ id: student.id, totalScore: overallAverage });

      const arm = student.currentClassId ? armById.get(student.currentClassId) : undefined;
      return {
        studentId: student.id,
        admissionNumber: student.admissionNumber,
        studentName: `${student.user.firstName} ${student.user.lastName}`,
        classArmId: arm?.id ?? "",
        classArmName: arm?.name ?? "",
        subjects,
        overallAverage,
        overallGrade: overallAverage !== null ? findGradeScaleMatch(gradeScales, overallAverage).grade : null,
        overallPosition: null,
      };
    });

    const overallPositions = assignPositions(overallRankable);
    for (const row of rows) {
      row.overallPosition = overallPositions.get(row.studentId) ?? null;
    }

    // Position/ranking above always runs over every row in scope, before
    // sort/pagination narrow what's actually returned — sorting by a column
    // must never change what "1st in class" means.
    const orderedRows = params.sortBy ? sortRows(rows, params.sortBy, params.sortDir ?? "desc") : rows;
    const total = orderedRows.length;
    const pageRows =
      params.take === undefined ? orderedRows : orderedRows.slice(params.skip ?? 0, (params.skip ?? 0) + params.take);

    return { ...emptyResponse, subjectColumns, rows: pageRows, total };
  }
}

@Controller("broadsheet")
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class BroadsheetController {
  constructor(private readonly service: BroadsheetService) {}

  @Get()
  @CheckPolicies((ability) => ability.can("read", "Broadsheet"))
  get(
    @Query("termId") termId?: string,
    @Query("academicSessionId") academicSessionId?: string,
    @Query("classLevelId") classLevelId?: string,
    @Query("classArmId") classArmId?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortDir") sortDir?: "asc" | "desc",
    @Query("skip") skip?: string,
    @Query("take") take?: string,
  ) {
    return this.service.build({
      termId,
      academicSessionId,
      classLevelId,
      classArmId,
      sortBy,
      sortDir,
      skip: skip === undefined ? undefined : Number(skip),
      take: take === undefined ? undefined : Number(take),
    });
  }
}
