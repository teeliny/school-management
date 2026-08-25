import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as argon2 from "argon2";
import {
  AssessmentComponentType,
  AssignmentType,
  ClassLevelCategory,
  DepartmentName,
  Gender,
  GuardianRelationship,
  ReportCommentType,
  Role,
  SkillCategory,
  SkillRatingValue,
  StaffCategory,
  SubjectType,
} from "@prisma/client";
import { DEFAULT_SCHEDULING_CONSTRAINTS } from "@school/types";
import { AppModule } from "./app.module";
import { PrismaService } from "./prisma/prisma.service";
import { InvitationService } from "./identity/invitations/invitation.service";
import { StudentService } from "./identity/students/student";
import { SubjectService } from "./subjects/subject";
import { StudentSubjectEnrollmentService } from "./subjects/student-subject-enrollment";
import { StudentDepartmentService } from "./academic-structure/student-department";
import { StaffAssignmentService } from "./staff-assignments/staff-assignment";
import { AssessmentComponentService } from "./assessments/assessment-component";
import { ReportWindowService } from "./assessments/report-window";
import { ScoreEntryService } from "./assessments/score-entry";
import { ReportCommentService } from "./assessments/report-comment";
import { SkillRatingService } from "./assessments/skill-rating";
import { FeeStructureService } from "./fees/fee-structure";
import { InvoiceService } from "./fees/invoice";
import { PaymentGatewayConfigService } from "./fees/gateway/payment-gateway-config";
import type { RequestUser } from "./auth/jwt.strategy";

/**
 * One-shot demo dataset for a fresh deployment (run after `pnpm setup:school`
 * has created the SchoolProfile + Super-Admin). Everything below is created
 * through the same services/transactions the real app uses (InvitationService
 * create+accept in place of the real email round-trip, StudentService.create
 * for guardian linking + compulsory-subject auto-enrollment, SubjectService
 * for the grouped-subject shape, StaffAssignmentService for the
 * co-teaching-guarded assignment path) rather than raw inserts, so the
 * resulting data obeys the same invariants real usage would produce.
 *
 * Safe-ish to re-run: every section checks for its own row(s) by unique key
 * before creating (same "check before create" shape as setup-school.ts), but
 * this hasn't been exercised as thoroughly as setup-school.ts's re-run path
 * — prefer running it once against a freshly reset database.
 *
 * Usage: pnpm --filter=@school/api run seed:demo
 */

const DEMO_PASSWORD = "12345678";
const EMAIL_DOMAIN = "deyoung.test";

/** Non-null lookup for the internal lookup maps below — every key used is a
 * literal defined earlier in this same script, so a miss means a typo here,
 * not bad input worth handling gracefully. */
function req<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

async function main() {
  const logger = new Logger("seed:demo");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const prisma = app.get(PrismaService);
  const invitations = app.get(InvitationService);
  const students = app.get(StudentService);
  const subjects = app.get(SubjectService);
  const subjectEnrollments = app.get(StudentSubjectEnrollmentService);
  const studentDepartments = app.get(StudentDepartmentService);
  const staffAssignments = app.get(StaffAssignmentService);
  const assessmentComponents = app.get(AssessmentComponentService);
  const reportWindows = app.get(ReportWindowService);
  const scoreEntries = app.get(ScoreEntryService);
  const reportComments = app.get(ReportCommentService);
  const skillRatings = app.get(SkillRatingService);
  const feeStructures = app.get(FeeStructureService);
  const invoices = app.get(InvoiceService);
  const paymentGatewayConfigs = app.get(PaymentGatewayConfigService);

  try {
    // -------------------------------------------------------------------
    // School profile + Super-Admin
    // -------------------------------------------------------------------
    const school = await prisma.schoolProfile.findFirst();
    if (!school) {
      throw new Error(
        "No SchoolProfile found — run `pnpm setup:school` first (this script only adds demo data on top of it).",
      );
    }
    logger.log(`Using school profile "${school.name}".`);

    let superAdmin = await prisma.user.findFirst({
      where: { roles: { some: { role: Role.SUPER_ADMIN, isActive: true } } },
    });
    if (!superAdmin) {
      logger.warn(
        "No active Super-Admin found — creating one directly with the demo password.",
      );
      superAdmin = await prisma.user.create({
        data: {
          email: "super-admin@" + EMAIL_DOMAIN,
          firstName: "Super",
          lastName: "Admin",
          status: "active",
          passwordHash: await argon2.hash(DEMO_PASSWORD),
        },
      });
      await prisma.userRole.create({
        data: { userId: superAdmin.id, role: Role.SUPER_ADMIN },
      });
      await prisma.adminProfile.upsert({
        where: { userId: superAdmin.id },
        update: {},
        create: { userId: superAdmin.id },
      });
    }

    // -------------------------------------------------------------------
    // Academic session + terms (2026/2027 — 2nd Monday in Sept 2026 to 3rd
    // Friday in July 2027)
    // -------------------------------------------------------------------
    const session = await upsertAcademicSession(prisma, {
      name: "2026/2027",
      startDate: new Date("2026-09-14"),
      endDate: new Date("2027-07-16"),
    });
    logger.log(`Academic session "${session.name}" ready.`);

    const termDefs = [
      {
        name: "1st Term",
        startDate: new Date("2026-09-14"),
        endDate: new Date("2026-12-18"),
      },
      {
        name: "2nd Term",
        startDate: new Date("2027-01-11"),
        endDate: new Date("2027-04-30"),
      },
      {
        name: "3rd Term",
        startDate: new Date("2027-05-10"),
        endDate: new Date("2027-07-16"),
      },
    ];
    const terms = [];
    for (const [i, def] of termDefs.entries()) {
      terms.push(await upsertTerm(prisma, session.id, def, i === 0));
    }
    logger.log(`Terms ready: ${terms.map((t) => t.name).join(", ")}.`);

    // -------------------------------------------------------------------
    // Assessment components per term × class group: 1st Test (CA) / Mid-Term
    // / 2nd Test (CA) / Exam, summing to 100 (10/20/10/60) as required by
    // the structure-completeness check (PRD §3.6) before any component can
    // open. Each component's input window is one quarter of its term.
    // -------------------------------------------------------------------
    const COMPONENT_DEFS: {
      type: AssessmentComponentType;
      sequence: number;
      name: string;
      maxScore: number;
    }[] = [
      {
        type: AssessmentComponentType.CA,
        sequence: 1,
        name: "1st Test",
        maxScore: 10,
      },
      {
        type: AssessmentComponentType.MID_TERM,
        sequence: 1,
        name: "Mid-Term Test",
        maxScore: 20,
      },
      {
        type: AssessmentComponentType.CA,
        sequence: 2,
        name: "2nd Test",
        maxScore: 10,
      },
      {
        type: AssessmentComponentType.EXAM,
        sequence: 1,
        name: "Exam",
        maxScore: 60,
      },
    ];
    for (const term of terms) {
      const windows = quarterWindows(term.startDate, term.endDate);
      for (const category of [ClassLevelCategory.JSS, ClassLevelCategory.SSS]) {
        for (const [i, def] of COMPONENT_DEFS.entries()) {
          const existing = await prisma.assessmentComponent.findUnique({
            where: {
              termId_classLevelCategory_type_sequence: {
                termId: term.id,
                classLevelCategory: category,
                type: def.type,
                sequence: def.sequence,
              },
            },
          });
          if (existing) continue;
          const window = req(windows[i], `assessment window ${i}`);
          await assessmentComponents.create(
            {
              termId: term.id,
              classLevelCategory: category,
              type: def.type,
              name: def.name,
              sequence: def.sequence,
              maxScore: def.maxScore,
              inputOpensAt: window.opensAt,
              inputClosesAt: window.closesAt,
              publishAt: window.closesAt,
            },
            superAdmin.id,
          );
        }
      }
    }
    logger.log(
      "Assessment components ready (10/20/10/60 per term × class group).",
    );

    // -------------------------------------------------------------------
    // Report windows per term × class group — governs both SkillRating entry
    // and the CLASS_TEACHER ReportComment (PRD §3.6). Opens alongside the
    // Exam component's own window (the last of the four quarters above, so
    // class teachers can start rating/commenting once teaching wraps up)
    // and closes a few days after the term itself ends, as grace time to
    // finish before the FULL_TERM report card's publish gate needs it.
    // -------------------------------------------------------------------
    const REPORT_WINDOW_GRACE_DAYS = 3;
    for (const term of terms) {
      const windows = quarterWindows(term.startDate, term.endDate);
      const examWindow = req(windows[3], "assessment window 3 (Exam)");
      const closesAt = new Date(
        term.endDate.getTime() + REPORT_WINDOW_GRACE_DAYS * 24 * 60 * 60 * 1000,
      );

      for (const category of [ClassLevelCategory.JSS, ClassLevelCategory.SSS]) {
        const existing = await prisma.reportWindow.findUnique({
          where: {
            termId_classLevelCategory: {
              termId: term.id,
              classLevelCategory: category,
            },
          },
        });
        if (existing) continue;
        await reportWindows.create(
          {
            termId: term.id,
            classLevelCategory: category,
            inputOpensAt: examWindow.opensAt,
            inputClosesAt: closesAt,
          },
          superAdmin.id,
        );
      }
    }
    logger.log(
      "Report windows ready (skill ratings + class-teacher comments, per term × class group).",
    );

    // -------------------------------------------------------------------
    // Class levels + single arm each (arm names = precious stones)
    // -------------------------------------------------------------------
    const levelDefs = [
      {
        name: "JSS 1",
        order: 4,
        category: ClassLevelCategory.JSS,
        arm: "DIAMOND",
      },
      {
        name: "JSS 2",
        order: 4,
        category: ClassLevelCategory.JSS,
        arm: "EMERALD",
      },
      {
        name: "JSS 3",
        order: 4,
        category: ClassLevelCategory.JSS,
        arm: "RUBY",
      },
      {
        name: "SSS 1",
        order: 5,
        category: ClassLevelCategory.SSS,
        arm: "SAPPHIRE",
      },
      {
        name: "SSS 2",
        order: 5,
        category: ClassLevelCategory.SSS,
        arm: "TOPAZ",
      },
      {
        name: "SSS 3",
        order: 5,
        category: ClassLevelCategory.SSS,
        arm: "AMETHYST",
      },
    ];
    const arms: Record<
      string,
      { id: string; classLevelId: string; category: ClassLevelCategory }
    > = {};
    for (const def of levelDefs) {
      const level = await prisma.classLevel.upsert({
        where: { name: def.name },
        update: {},
        create: { name: def.name, order: def.order, category: def.category },
      });
      let arm = await prisma.classArm.findFirst({
        where: { classLevelId: level.id, academicSessionId: session.id },
      });
      if (!arm) {
        arm = await prisma.classArm.create({
          data: {
            classLevelId: level.id,
            academicSessionId: session.id,
            name: def.arm,
          },
        });
      }
      arms[def.name] = {
        id: arm.id,
        classLevelId: level.id,
        category: def.category,
      };
    }
    logger.log(`Class levels + arms ready: ${Object.keys(arms).join(", ")}.`);

    const jssArmIds = ["JSS 1", "JSS 2", "JSS 3"].map(
      (n) => req(arms[n], `class arm for ${n}`).id,
    );
    const sssArmIds = ["SSS 1", "SSS 2", "SSS 3"].map(
      (n) => req(arms[n], `class arm for ${n}`).id,
    );

    // -------------------------------------------------------------------
    // Departments (SSS only)
    // -------------------------------------------------------------------
    const departmentIds: Record<DepartmentName, string> = {} as Record<
      DepartmentName,
      string
    >;
    for (const name of [
      DepartmentName.SCIENCE,
      DepartmentName.COMMERCIAL,
      DepartmentName.ART,
    ]) {
      const dept = await prisma.department.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      departmentIds[name] = dept.id;
    }

    // -------------------------------------------------------------------
    // Subject catalogue: plain JSS/SSS subjects + three grouped subjects
    // (PRD §3.3's "Basic Science and Technology" shape) — Basic Science and
    // Technology, Pre-Vocational Studies, and Cultural and Creative Arts —
    // each with independently-scored children.
    // -------------------------------------------------------------------
    const simpleSubjectDefs: {
      code: string;
      name: string;
      requiresCalculation?: boolean;
    }[] = [
      { code: "MTH", name: "Mathematics", requiresCalculation: true },
      // SSS's own optional Civic Education elective — distinct Subject row
      // from NVE's "Civic Education" child below: SubjectService.findAll
      // always filters out child subjects (parentSubjectId != null) from
      // top-level results, so the NVE child could never surface in
      // `/subjects?classLevelCategory=SSS` if reused directly.
      { code: "CIVS", name: "Civic Education" },
      { code: "BUS", name: "Business Studies" },
      { code: "CRS", name: "Christian Religious Studies" },
      { code: "FRE", name: "French Language" },
      { code: "YOR", name: "Yoruba Language" },
      { code: "FMT", name: "Further Mathematics", requiresCalculation: true },
      { code: "PHY", name: "Physics", requiresCalculation: true },
      { code: "CHM", name: "Chemistry", requiresCalculation: true },
      { code: "BIO", name: "Biology" },
      { code: "ACC", name: "Financial Accounting", requiresCalculation: true },
      { code: "COM", name: "Commerce" },
      { code: "ECO", name: "Economics" },
      { code: "LIT", name: "Literature in English" },
      { code: "GOV", name: "Government" },
      { code: "DPS", name: "Data Processing" },
      { code: "MKT", name: "Marketing" },
      { code: "GEO", name: "Geography" },
      { code: "FNU", name: "Food and Nutrition" },
    ];

    const subjectIdByCode: Record<string, string> = {};
    for (const def of simpleSubjectDefs) {
      const existing = await prisma.subject.findUnique({
        where: { code: def.code },
      });
      const row =
        existing ??
        (await subjects.create({
          name: def.name,
          code: def.code,
          requiresCalculation: def.requiresCalculation ?? false,
        }));
      subjectIdByCode[def.code] = row.id;
    }

    let bstGroup = await prisma.subject.findUnique({ where: { code: "BST" } });
    if (!bstGroup) {
      bstGroup = await subjects.createGroup({
        name: "Basic Science and Technology",
        code: "BST",
        children: [
          { name: "Basic Science", code: "BSC", weight: 25 },
          { name: "Basic Technology", code: "BTN", weight: 25 },
          { name: "Information Technology", code: "IT", weight: 25 },
          { name: "Physical and Health Education", code: "PHE", weight: 25 },
        ],
      });
    }
    subjectIdByCode.BST = bstGroup.id;
    for (const childCode of ["BSC", "BTN", "IT", "PHE"]) {
      const child = await prisma.subject.findUniqueOrThrow({
        where: { code: childCode },
      });
      subjectIdByCode[childCode] = child.id;
    }

    // Pre-Vocational Studies (JSS only) — Agric Science and Home Economics
    // are taught/scored as its independent children, not standalone subjects.
    let pvsGroup = await prisma.subject.findUnique({ where: { code: "PVS" } });
    if (!pvsGroup) {
      pvsGroup = await subjects.createGroup({
        name: "Pre-Vocational Studies",
        code: "PVS",
        children: [
          { name: "Agricultural Science", code: "AGR", weight: 50 },
          { name: "Home Economics", code: "HEC", weight: 50 },
        ],
      });
    }
    subjectIdByCode.PVS = pvsGroup.id;
    for (const childCode of ["AGR", "HEC"]) {
      const child = await prisma.subject.findUniqueOrThrow({
        where: { code: childCode },
      });
      subjectIdByCode[childCode] = child.id;
    }

    // Cultural and Creative Arts (JSS only) — Music and Creative Art, same
    // independently-scored-children shape as BST/PVS above.
    let ccaGroup = await prisma.subject.findUnique({ where: { code: "CCA" } });
    if (!ccaGroup) {
      ccaGroup = await subjects.createGroup({
        name: "Cultural and Creative Arts",
        code: "CCA",
        children: [
          { name: "Music", code: "MUS", weight: 50 },
          { name: "Creative Art", code: "CRA", weight: 50 },
        ],
      });
    }
    subjectIdByCode.CCA = ccaGroup.id;
    for (const childCode of ["MUS", "CRA"]) {
      const child = await prisma.subject.findUniqueOrThrow({
        where: { code: childCode },
      });
      subjectIdByCode[childCode] = child.id;
    }

    // National Value Education (JSS only) — Social Studies, Security
    // Education, and Civic Education combine into one taught/scored group.
    let nveGroup = await prisma.subject.findUnique({ where: { code: "NVE" } });
    if (!nveGroup) {
      nveGroup = await subjects.createGroup({
        name: "National Value Education",
        code: "NVE",
        children: [
          { name: "Social Studies", code: "SOS", weight: 34 },
          { name: "Security Education", code: "SEC", weight: 33 },
          { name: "Civic Education", code: "CIV", weight: 33 },
        ],
      });
    }
    subjectIdByCode.NVE = nveGroup.id;
    for (const childCode of ["SOS", "SEC", "CIV"]) {
      const child = await prisma.subject.findUniqueOrThrow({
        where: { code: childCode },
      });
      subjectIdByCode[childCode] = child.id;
    }

    // English Language (both JSS and SSS) — Oral and Essay, and Summary and
    // Comprehension, same independently-scored-children shape as the groups
    // above.
    let engGroup = await prisma.subject.findUnique({ where: { code: "ENG" } });
    if (!engGroup) {
      engGroup = await subjects.createGroup({
        name: "English Language",
        code: "ENG",
        children: [
          { name: "Oral and Essay", code: "ENG-01", weight: 50 },
          { name: "Summary and Comprehension", code: "ENG-02", weight: 50 },
        ],
      });
    }
    subjectIdByCode.ENG = engGroup.id;
    for (const childCode of ["ENG-01", "ENG-02"]) {
      const child = await prisma.subject.findUniqueOrThrow({
        where: { code: childCode },
      });
      subjectIdByCode[childCode] = child.id;
    }
    logger.log(
      `Subject catalogue ready: ${Object.keys(subjectIdByCode).length} subjects.`,
    );

    // A ClassSubject/StudentSubjectEnrollment row for a grouped subject
    // (ENG/BST/PVS/CCA/NVE) always names the group's own subjectId, never a
    // child's — but ScoreEntryService rejects scoring the group directly
    // (only children are scoreable). This is the single place that expands
    // a class-subject code into the subject id(s) actual scores get entered
    // against, so the score-seeding loop below and any future caller can't
    // drift on which codes are groups.
    const GROUP_CHILD_CODES: Record<string, string[]> = {
      ENG: ["ENG-01", "ENG-02"],
      BST: ["BSC", "BTN", "IT", "PHE"],
      PVS: ["AGR", "HEC"],
      CCA: ["MUS", "CRA"],
      NVE: ["SOS", "SEC", "CIV"],
    };
    function scoreableSubjectIdsForCode(code: string): string[] {
      const children = GROUP_CHILD_CODES[code];
      if (children) {
        return children.map((c) => req(subjectIdByCode[c], `subject id for ${c}`));
      }
      return [req(subjectIdByCode[code], `subject id for ${code}`)];
    }

    // BUILD_PLAN.md §9 Step 2 follow-up: real weekly period loads (not the
    // uniform default-3 every ClassSubject row starts at) — Math/English run
    // heavier than most, a handful of lighter subjects run at 2 or 1. Tuned
    // so JSS's total (with the group-child overrides below) lands exactly at
    // JSS_SSS's 40 periods/week capacity (PERIODS_PER_DAY=8 × 5 days).
    const jssPeriodsPerWeek: Record<string, number> = {
      ENG: 4,
      MTH: 4,
      BST: 3,
      NVE: 3,
      PVS: 3,
      BUS: 3,
      CRS: 2,
      FRE: 2,
      YOR: 2,
      CCA: 3,
    };

    // classLevelCategory:code -> ClassSubject id, populated as each row is
    // upserted below — the child-period-override step further down needs
    // this to target the exact (category-scoped) row a group's children
    // belong to, since e.g. ENG has one row for JSS and a separate one for SSS.
    const classSubjectIdByKey: Record<string, string> = {};

    // Class-subject applicability.
    const jssClassSubjects: { code: string; type: SubjectType }[] = [
      { code: "ENG", type: SubjectType.COMPULSORY },
      { code: "MTH", type: SubjectType.COMPULSORY },
      { code: "BST", type: SubjectType.COMPULSORY },
      { code: "NVE", type: SubjectType.COMPULSORY },
      { code: "PVS", type: SubjectType.COMPULSORY },
      { code: "BUS", type: SubjectType.COMPULSORY },
      { code: "CRS", type: SubjectType.COMPULSORY },
      { code: "FRE", type: SubjectType.GENERAL },
      { code: "YOR", type: SubjectType.GENERAL },
      { code: "CCA", type: SubjectType.GENERAL },
    ];
    for (const cs of jssClassSubjects) {
      const row = await upsertClassSubject(prisma, {
        classLevelCategory: ClassLevelCategory.JSS,
        subjectId: req(subjectIdByCode[cs.code], `subject id for ${cs.code}`),
        type: cs.type,
        periodsPerWeek: jssPeriodsPerWeek[cs.code],
      });
      classSubjectIdByKey[`JSS:${cs.code}`] = row.id;
    }

    // SSS does not offer Business Studies, Information Technology, or
    // Cultural and Creative Arts at all (JSS-only). Agric Science carries
    // over from JSS but as an optional GENERAL elective, not department-
    // restricted; Data Processing, Marketing, Geography, and Food and
    // Nutrition are SSS-only optional electives; Civic Education is
    // optional here too — via the separate CIVS subject, not NVE's child
    // (see the CIVS comment above). Biology, Economics, and Government are
    // GENERAL (open to any student), not department-restricted, despite
    // being the "obvious" pick for their usual department.
    const sssClassSubjects: {
      code: string;
      type: SubjectType;
      department?: DepartmentName;
    }[] = [
      { code: "ENG", type: SubjectType.COMPULSORY },
      { code: "MTH", type: SubjectType.COMPULSORY },
      { code: "FMT", type: SubjectType.GENERAL },
      { code: "AGR", type: SubjectType.GENERAL },
      { code: "DPS", type: SubjectType.GENERAL },
      { code: "MKT", type: SubjectType.GENERAL },
      { code: "GEO", type: SubjectType.GENERAL },
      { code: "CIVS", type: SubjectType.GENERAL },
      { code: "FNU", type: SubjectType.GENERAL },
      { code: "BIO", type: SubjectType.GENERAL },
      { code: "ECO", type: SubjectType.GENERAL },
      { code: "GOV", type: SubjectType.GENERAL },
      {
        code: "PHY",
        type: SubjectType.DEPARTMENT,
        department: DepartmentName.SCIENCE,
      },
      {
        code: "CHM",
        type: SubjectType.DEPARTMENT,
        department: DepartmentName.SCIENCE,
      },
      {
        code: "ACC",
        type: SubjectType.DEPARTMENT,
        department: DepartmentName.COMMERCIAL,
      },
      {
        code: "COM",
        type: SubjectType.DEPARTMENT,
        department: DepartmentName.COMMERCIAL,
      },
      {
        code: "LIT",
        type: SubjectType.DEPARTMENT,
        department: DepartmentName.ART,
      },
      {
        code: "CRS",
        type: SubjectType.DEPARTMENT,
        department: DepartmentName.ART,
      },
      {
        code: "YOR",
        type: SubjectType.DEPARTMENT,
        department: DepartmentName.ART,
      },
    ];

    // Same "not uniform 3" reasoning as jssPeriodsPerWeek above. Every
    // ClassSubjectConcurrencyGroup member below is deliberately given the
    // same periodsPerWeek (ClassSubjectService enforces this) so the block
    // shares one slot/day cleanly.
    const sssPeriodsPerWeek: Record<string, number> = {
      ENG: 4,
      MTH: 4,
      FMT: 3,
      AGR: 3,
      DPS: 2,
      MKT: 2,
      GEO: 3,
      CIVS: 2,
      FNU: 3,
      BIO: 3,
      ECO: 3,
      GOV: 3,
      PHY: 3,
      CHM: 3,
      ACC: 3,
      COM: 3,
      LIT: 3,
      CRS: 3,
      YOR: 3,
    };

    // "Options column" elective blocks (schema.prisma's
    // ClassSubjectConcurrencyGroup, BUILD_PLAN.md §9 Step 2 follow-up) — one
    // subject per department taken at the exact same weekly slot / exam day,
    // since no SSS student is ever enrolled in more than one member of a
    // given block (see SSS_DEPARTMENT_ELECTIVE_BASE below). Without this,
    // SSS's 19 ClassSubject rows sum to 56 periods/week against JSS_SSS's
    // 40-period capacity — infeasible for the class-timetable solver
    // regardless of staffing; collapsing these four blocks to one slot each
    // brings it down to 38.
    const sssConcurrencyGroupDefs: { name: string; codes: string[] }[] = [
      { name: "Physics / Accounting / Literature", codes: ["PHY", "ACC", "LIT"] },
      { name: "chem/crs/commerce", codes: ["CHM", "CRS", "COM"] },
      { name: "Geo / Govt", codes: ["GEO", "GOV"] },
      { name: "Agric/F&N", codes: ["AGR", "FNU"] },
      { name: "Marketing / Data Processing", codes: ["MKT", "DPS"] },
    ];
    const concurrencyGroupIdByCode: Record<string, string> = {};
    for (const def of sssConcurrencyGroupDefs) {
      const group = await ensureConcurrencyGroup(prisma, def.name, ClassLevelCategory.SSS);
      for (const code of def.codes) concurrencyGroupIdByCode[code] = group.id;
    }

    for (const cs of sssClassSubjects) {
      const row = await upsertClassSubject(prisma, {
        classLevelCategory: ClassLevelCategory.SSS,
        subjectId: req(subjectIdByCode[cs.code], `subject id for ${cs.code}`),
        type: cs.type,
        departmentId: cs.department
          ? req(
              departmentIds[cs.department],
              `department id for ${cs.department}`,
            )
          : undefined,
        periodsPerWeek: sssPeriodsPerWeek[cs.code],
        concurrencyGroupId: concurrencyGroupIdByCode[cs.code],
      });
      classSubjectIdByKey[`SSS:${cs.code}`] = row.id;
    }
    logger.log("Class-subject applicability ready.");

    // Per-child periods/week overrides (schema.prisma's
    // ClassSubjectChildPeriods) — a group subject's children often need
    // different weekly loads rather than uniformly inheriting the parent
    // row's value (e.g. BST's Basic Science/Basic Technology stay at the
    // group default of 3 while Information Technology and Physical and
    // Health Education run lighter at 2). category:groupCode keys into
    // classSubjectIdByKey since e.g. ENG has independent JSS and SSS rows.
    const childPeriodOverrides: {
      category: ClassLevelCategory;
      groupCode: string;
      childCode: string;
      periodsPerWeek: number;
    }[] = [
      { category: ClassLevelCategory.JSS, groupCode: "BST", childCode: "IT", periodsPerWeek: 2 },
      { category: ClassLevelCategory.JSS, groupCode: "BST", childCode: "PHE", periodsPerWeek: 2 },
      { category: ClassLevelCategory.JSS, groupCode: "CCA", childCode: "CRA", periodsPerWeek: 2 },
      { category: ClassLevelCategory.JSS, groupCode: "CCA", childCode: "MUS", periodsPerWeek: 2 },
      { category: ClassLevelCategory.JSS, groupCode: "NVE", childCode: "CIV", periodsPerWeek: 2 },
      { category: ClassLevelCategory.JSS, groupCode: "NVE", childCode: "SEC", periodsPerWeek: 1 },
      { category: ClassLevelCategory.JSS, groupCode: "NVE", childCode: "SOS", periodsPerWeek: 2 },
      { category: ClassLevelCategory.JSS, groupCode: "PVS", childCode: "AGR", periodsPerWeek: 2 },
      { category: ClassLevelCategory.JSS, groupCode: "PVS", childCode: "HEC", periodsPerWeek: 2 },
      { category: ClassLevelCategory.JSS, groupCode: "ENG", childCode: "ENG-01", periodsPerWeek: 2 },
      { category: ClassLevelCategory.JSS, groupCode: "ENG", childCode: "ENG-02", periodsPerWeek: 2 },
      { category: ClassLevelCategory.SSS, groupCode: "ENG", childCode: "ENG-01", periodsPerWeek: 2 },
      { category: ClassLevelCategory.SSS, groupCode: "ENG", childCode: "ENG-02", periodsPerWeek: 2 },
    ];
    for (const o of childPeriodOverrides) {
      const classSubjectId = req(
        classSubjectIdByKey[`${o.category}:${o.groupCode}`],
        `classSubject id for ${o.category} ${o.groupCode}`,
      );
      const childSubjectId = req(subjectIdByCode[o.childCode], `subject id for ${o.childCode}`);
      await prisma.classSubjectChildPeriods.upsert({
        where: { classSubjectId_childSubjectId: { classSubjectId, childSubjectId } },
        create: { classSubjectId, childSubjectId, periodsPerWeek: o.periodsPerWeek },
        update: { periodsPerWeek: o.periodsPerWeek },
      });
    }
    logger.log("Elective blocks and per-child periods/week ready.");

    // JSS has no departments — every student opts into all three GENERAL
    // electives (French, Yoruba, Cultural and Creative Arts) on top of their
    // auto-enrolled COMPULSORY subjects.
    const JSS_GENERAL_CODES = ["FRE", "YOR", "CCA"];

    // SSS department elective lists (COMPULSORY English/Maths auto-enroll
    // separately and aren't repeated here). Biology and Further Maths drop
    // out for SSS 3 in every department, which is what takes each
    // department's SSS 3 registered-subject count two below its SSS 1/2
    // count (Science/Commercial 11→9, Art 12→10) — matching the brief's
    // explicit SSS 3 counts.
    const SSS_DEPARTMENT_ELECTIVE_BASE: Record<DepartmentName, string[]> = {
      [DepartmentName.ART]: ["LIT", "YOR", "CRS", "GOV", "ECO", "CIVS", "MKT", "AGR"],
      [DepartmentName.COMMERCIAL]: ["ACC", "COM", "GOV", "ECO", "CIVS", "MKT", "AGR"],
      [DepartmentName.SCIENCE]: ["PHY", "CHM", "GEO", "ECO", "CIVS", "MKT", "AGR"],
    };
    const SSS3_DROPPED_CODES = ["BIO", "FMT"];
    function sssElectiveCodesFor(department: DepartmentName, className: string): string[] {
      const base = req(SSS_DEPARTMENT_ELECTIVE_BASE[department], `elective base for ${department}`);
      return className === "SSS 3" ? base : [...base, ...SSS3_DROPPED_CODES];
    }

    // -------------------------------------------------------------------
    // Skill assessment items for the session (PRD FR4.5 default lists)
    // -------------------------------------------------------------------
    const skillDefs: {
      category: SkillCategory;
      name: string;
      order: number;
    }[] = [
      { category: SkillCategory.PSYCHOMOTOR, name: "Handwriting", order: 1 },
      { category: SkillCategory.PSYCHOMOTOR, name: "Verbal Fluency", order: 2 },
      {
        category: SkillCategory.PSYCHOMOTOR,
        name: "Sports and Games",
        order: 3,
      },
      { category: SkillCategory.PSYCHOMOTOR, name: "Musical Skills", order: 4 },
      {
        category: SkillCategory.PSYCHOMOTOR,
        name: "Handling of Tools and Instruments",
        order: 5,
      },
      {
        category: SkillCategory.AFFECTIVE_COGNITIVE,
        name: "Punctuality",
        order: 1,
      },
      {
        category: SkillCategory.AFFECTIVE_COGNITIVE,
        name: "Neatness",
        order: 2,
      },
      {
        category: SkillCategory.AFFECTIVE_COGNITIVE,
        name: "Honesty",
        order: 3,
      },
      {
        category: SkillCategory.AFFECTIVE_COGNITIVE,
        name: "Leadership",
        order: 4,
      },
      {
        category: SkillCategory.AFFECTIVE_COGNITIVE,
        name: "Relationship with Others",
        order: 5,
      },
    ];
    for (const def of skillDefs) {
      const existing = await prisma.skillAssessmentItem.findUnique({
        where: {
          academicSessionId_category_name: {
            academicSessionId: session.id,
            category: def.category,
            name: def.name,
          },
        },
      });
      if (!existing) {
        await prisma.skillAssessmentItem.create({
          data: {
            academicSessionId: session.id,
            category: def.category,
            name: def.name,
            order: def.order,
          },
        });
      }
    }
    logger.log(`Skill assessment items ready: ${skillDefs.length} items.`);

    // -------------------------------------------------------------------
    // Grade scale — school-wide (not session/term-scoped), matching the
    // 6-band set already found in this deployment's database (A-F, 70+
    // down to 0). No unique key on GradeScale itself, so dedupe by
    // (grade, minScore) before creating, same "check before create"
    // shape as everything else in this file.
    // -------------------------------------------------------------------
    const gradeScaleDefs: {
      minScore: number;
      maxScore: number;
      grade: string;
      remark: string;
      gradePoint: number;
    }[] = [
      { minScore: 70, maxScore: 100, grade: "A", remark: "EXCELLENT", gradePoint: 5 },
      { minScore: 60, maxScore: 69.99, grade: "B", remark: "VERY GOOD", gradePoint: 4 },
      { minScore: 50, maxScore: 59.99, grade: "C", remark: "GOOD", gradePoint: 3 },
      { minScore: 45, maxScore: 49.99, grade: "D", remark: "POOR", gradePoint: 2 },
      { minScore: 40, maxScore: 44.99, grade: "E", remark: "VERY POOR", gradePoint: 1 },
      { minScore: 0, maxScore: 39.99, grade: "F", remark: "FAIL", gradePoint: 0 },
    ];
    for (const def of gradeScaleDefs) {
      const existing = await prisma.gradeScale.findFirst({
        where: { grade: def.grade, minScore: def.minScore },
      });
      if (existing) continue;
      await prisma.gradeScale.create({ data: def });
    }
    logger.log(`Grade scale ready: ${gradeScaleDefs.length} bands.`);

    // -------------------------------------------------------------------
    // Scheduling constraints (PRD §3.8) — `pnpm setup:school` already seeds
    // these same defaults (see setup-school.ts), but this script is
    // documented to run against a freshly reset database and shouldn't
    // silently depend on that earlier step having succeeded, so it's
    // repeated here with the identical idempotent shape: a group-scoped row
    // can use Prisma's typed .upsert() against the (scope,
    // classLevelCategoryGroup, key) compound unique, but the global
    // (classLevelCategoryGroup=null) rows can't — Postgres doesn't treat two
    // NULLs as equal for that unique index, hence the hand-added partial
    // index and the manual find-then-create fallback, same precedent as
    // GradeScale above and StaffAssignment's reconciliation (CLAUDE.md). A
    // second run now reconciles `value` on every existing row too (not just
    // creating missing ones) — this script is also how period-structure
    // tuning (BUILD_PLAN.md §9 Step 2 follow-up) gets applied to an
    // already-seeded database, so a value bump in DEFAULT_SCHEDULING_
    // CONSTRAINTS needs to actually take on a reseed, not silently no-op.
    // -------------------------------------------------------------------
    for (const constraint of DEFAULT_SCHEDULING_CONSTRAINTS) {
      if (constraint.classLevelCategoryGroup) {
        await prisma.schedulingConstraint.upsert({
          where: {
            scope_classLevelCategoryGroup_key: {
              scope: constraint.scope,
              classLevelCategoryGroup: constraint.classLevelCategoryGroup,
              key: constraint.key,
            },
          },
          update: { value: constraint.value },
          create: constraint,
        });
        continue;
      }

      const existing = await prisma.schedulingConstraint.findFirst({
        where: { scope: constraint.scope, classLevelCategoryGroup: null, key: constraint.key },
      });
      if (existing) {
        await prisma.schedulingConstraint.update({ where: { id: existing.id }, data: { value: constraint.value } });
      } else {
        await prisma.schedulingConstraint.create({ data: constraint });
      }
    }
    logger.log(`Scheduling constraints ready: ${DEFAULT_SCHEDULING_CONSTRAINTS.length} rows.`);

    // -------------------------------------------------------------------
    // Admin + Bursar + Registrar + Principal
    // -------------------------------------------------------------------
    const admin = await ensureRoleUser(prisma, invitations, {
      email: `admin.grace@${EMAIL_DOMAIN}`,
      firstName: "Grace",
      lastName: "Okonkwo",
      role: Role.ADMIN,
      invitedByUserId: superAdmin.id,
    });
    logger.log(`Admin ready: ${admin.email}`);

    const bursarUser = await ensureRoleUser(prisma, invitations, {
      email: `bursar.ifeoma@${EMAIL_DOMAIN}`,
      firstName: "Ifeoma",
      lastName: "Chukwu",
      role: Role.STAFF,
      staffCategory: StaffCategory.NON_TEACHING,
      invitedByUserId: superAdmin.id,
    });
    const bursarStaffProfile = await prisma.staffProfile.findUniqueOrThrow({
      where: { userId: bursarUser.id },
    });
    await ensureStaffAssignment(prisma, staffAssignments, {
      staffId: bursarStaffProfile.id,
      assignmentType: AssignmentType.BURSAR,
      academicSessionId: session.id,
    });

    const registrarUser = await ensureRoleUser(prisma, invitations, {
      email: `registrar.emeka@${EMAIL_DOMAIN}`,
      firstName: "Emeka",
      lastName: "Nwosu",
      role: Role.STAFF,
      staffCategory: StaffCategory.NON_TEACHING,
      invitedByUserId: superAdmin.id,
    });
    const registrarStaffProfile = await prisma.staffProfile.findUniqueOrThrow({
      where: { userId: registrarUser.id },
    });
    await ensureStaffAssignment(prisma, staffAssignments, {
      staffId: registrarStaffProfile.id,
      assignmentType: AssignmentType.REGISTRAR,
      academicSessionId: session.id,
    });

    const principalUser = await ensureRoleUser(prisma, invitations, {
      email: `principal.olusegun@${EMAIL_DOMAIN}`,
      firstName: "Olusegun",
      lastName: "Bakare",
      role: Role.STAFF,
      staffCategory: StaffCategory.NON_TEACHING,
      invitedByUserId: superAdmin.id,
    });
    const principalStaffProfile = await prisma.staffProfile.findUniqueOrThrow({
      where: { userId: principalUser.id },
    });
    await ensureStaffAssignment(prisma, staffAssignments, {
      staffId: principalStaffProfile.id,
      assignmentType: AssignmentType.PRINCIPAL,
      academicSessionId: session.id,
    });
    logger.log("Bursar, Registrar, Principal ready.");

    // -------------------------------------------------------------------
    // 21 teachers — covers all 32 of the catalogue's assignable
    // (non-group-parent) subjects. A teacher's SUBJECT_TEACHER assignment
    // always spans every arm within ONE class-level category (all 3 JSS
    // arms, or all 3 SSS arms) — never a single arm, and never both
    // categories at once. A subject offered at both JSS and SSS (English,
    // Mathematics, CRS, Agricultural Science, Yoruba) therefore gets two
    // separate teachers below, one per category, matching how a real school
    // staffs a "shared" subject name with distinct junior/senior posts
    // rather than one teacher commuting between both wings.
    // -------------------------------------------------------------------
    const SCOPE: Record<string, "JSS_ONLY" | "SSS_ONLY"> = {
      // JSS only — includes BST/PVS/CCA/NVE's children (the group parents
      // themselves are never directly assignable) plus BUS, which SSS
      // doesn't offer at all. NVE's own "CIV" child is JSS-only — SSS's
      // optional Civic Education is the separate CIVS subject, below.
      BSC: "JSS_ONLY",
      BTN: "JSS_ONLY",
      IT: "JSS_ONLY",
      PHE: "JSS_ONLY",
      HEC: "JSS_ONLY",
      MUS: "JSS_ONLY",
      CRA: "JSS_ONLY",
      SOS: "JSS_ONLY",
      SEC: "JSS_ONLY",
      CIV: "JSS_ONLY",
      FRE: "JSS_ONLY",
      BUS: "JSS_ONLY",
      // SSS only.
      FMT: "SSS_ONLY",
      DPS: "SSS_ONLY",
      MKT: "SSS_ONLY",
      GEO: "SSS_ONLY",
      CIVS: "SSS_ONLY",
      FNU: "SSS_ONLY",
      PHY: "SSS_ONLY",
      CHM: "SSS_ONLY",
      BIO: "SSS_ONLY",
      ACC: "SSS_ONLY",
      COM: "SSS_ONLY",
      ECO: "SSS_ONLY",
      LIT: "SSS_ONLY",
      GOV: "SSS_ONLY",
      // ENG-01/ENG-02/MTH/CRS/AGR/YOR are deliberately absent — each is
      // offered at both JSS and SSS (AGR via JSS's PVS group and directly
      // for SSS; YOR as SSS's ART-department elective; see the
      // sssClassSubjects comment above; ENG's two children stand in for the
      // ENG group parent, never directly assignable like BST/PVS/CCA/NVE),
      // so its category is tagged explicitly per teacherDefs entry below via
      // `subjectFor` instead of resolved from this map.
    };

    /**
     * Resolves a subject code to the category its SUBJECT_TEACHER
     * assignment should span. Unambiguous codes (JSS-only/SSS-only) resolve
     * straight from SCOPE; a code taught at both levels (ENG-01/ENG-02/MTH/
     * CRS/AGR/YOR) requires an explicit category per call, since it's staffed
     * by two separate teachers below — one per category.
     */
    function subjectFor(
      code: string,
      explicitCategory?: "JSS" | "SSS",
    ): { code: string; category: "JSS" | "SSS" } {
      if (explicitCategory) return { code, category: explicitCategory };
      const scope = req(SCOPE[code], `SCOPE entry for ${code}`);
      return { code, category: scope === "JSS_ONLY" ? "JSS" : "SSS" };
    }

    // `classTeacherOf` (a key into `arms`, e.g. "JSS 1") is only set for the
    // six teachers doubling as their class's CLASS_TEACHER — chosen from
    // among whoever already teaches a subject spanning that exact category,
    // so the pairing reads as a real teacher's real class, not an arbitrary
    // assignment.
    const teacherDefs: {
      firstName: string;
      lastName: string;
      subjects: { code: string; category: "JSS" | "SSS" }[];
      classTeacherOf?: string;
    }[] = [
      {
        firstName: "Chidinma",
        lastName: "Eze",
        subjects: [subjectFor("ENG-01", "JSS"), subjectFor("ENG-02", "JSS")],
      },
      // Tunde already teaches Further Maths (SSS-only) — a natural senior
      // mathematics post, so his Mathematics assignment is the SSS side too
      // (JSS Mathematics gets its own teacher, Femi, below).
      { firstName: "Tunde", lastName: "Afolabi", subjects: [subjectFor("MTH", "SSS"), subjectFor("FMT")] },
      { firstName: "Ngozi", lastName: "Umeh", subjects: [subjectFor("BSC"), subjectFor("PHY")] },
      { firstName: "Bola", lastName: "Adeyemi", subjects: [subjectFor("BTN"), subjectFor("CHM")] },
      { firstName: "Fatima", lastName: "Sule", subjects: [subjectFor("IT"), subjectFor("BIO")] },
      {
        firstName: "Kelechi",
        lastName: "Obi",
        subjects: [subjectFor("PHE"), subjectFor("AGR", "JSS")],
        classTeacherOf: "JSS 1",
      },
      {
        firstName: "Amaka",
        lastName: "Nwachukwu",
        subjects: [subjectFor("SOS"), subjectFor("GEO")],
        classTeacherOf: "JSS 2",
      },
      {
        firstName: "Yusuf",
        lastName: "Abdullahi",
        subjects: [subjectFor("SEC"), subjectFor("ECO")],
        classTeacherOf: "JSS 3",
      },
      {
        firstName: "Blessing",
        lastName: "Etim",
        subjects: [subjectFor("HEC"), subjectFor("COM")],
        classTeacherOf: "SSS 1",
      },
      { firstName: "Ibrahim", lastName: "Musa", subjects: [subjectFor("BUS"), subjectFor("DPS")] },
      {
        firstName: "Peter",
        lastName: "Okafor",
        subjects: [subjectFor("GOV"), subjectFor("LIT")],
        classTeacherOf: "SSS 3",
      },
      { firstName: "Halima", lastName: "Bello", subjects: [subjectFor("FRE"), subjectFor("CRS", "JSS")] },
      { firstName: "Adaeze", lastName: "Uche", subjects: [subjectFor("YOR", "JSS"), subjectFor("CIV")] },
      { firstName: "Segun", lastName: "Alabi", subjects: [subjectFor("MUS"), subjectFor("CRA")] },
      {
        firstName: "Chioma",
        lastName: "Nnaji",
        subjects: [subjectFor("ACC"), subjectFor("CIVS")],
        classTeacherOf: "SSS 2",
      },
      { firstName: "David", lastName: "Osagie", subjects: [subjectFor("MKT"), subjectFor("FNU")] },
      // The other side of each shared subject above: JSS Mathematics (Tunde
      // is now SSS-only), and the SSS side of English/CRS/Agric/Yoruba.
      { firstName: "Femi", lastName: "Ogunleye", subjects: [subjectFor("MTH", "JSS")] },
      { firstName: "Chinwe", lastName: "Okoli", subjects: [subjectFor("ENG-01", "SSS"), subjectFor("ENG-02", "SSS")] },
      { firstName: "Uche", lastName: "Nnamdi", subjects: [subjectFor("CRS", "SSS")] },
      { firstName: "Bimpe", lastName: "Adewale", subjects: [subjectFor("AGR", "SSS")] },
      { firstName: "Gbenga", lastName: "Fashola", subjects: [subjectFor("YOR", "SSS")] },
    ];

    // Keyed by class name (e.g. "JSS 1"), populated below as each class
    // teacher is assigned — used by the report-comment/skill-rating seeding
    // further down so those write as the student's real class teacher
    // rather than an anonymous Admin override.
    const classTeacherUserIdByClassName: Record<string, string> = {};

    let classTeacherCount = 0;
    for (const def of teacherDefs) {
      const email = `${def.firstName.toLowerCase()}.${def.lastName.toLowerCase()}@${EMAIL_DOMAIN}`;
      const teacherUser = await ensureRoleUser(prisma, invitations, {
        email,
        firstName: def.firstName,
        lastName: def.lastName,
        role: Role.STAFF,
        staffCategory: StaffCategory.TEACHING,
        invitedByUserId: superAdmin.id,
      });
      const staffProfile = await prisma.staffProfile.findUniqueOrThrow({
        where: { userId: teacherUser.id },
      });
      for (const subject of def.subjects) {
        for (const classArmId of subject.category === "JSS" ? jssArmIds : sssArmIds) {
          await ensureStaffAssignment(prisma, staffAssignments, {
            staffId: staffProfile.id,
            assignmentType: AssignmentType.SUBJECT_TEACHER,
            subjectId: subjectIdByCode[subject.code],
            classArmId,
            academicSessionId: session.id,
          });
        }
      }
      if (def.classTeacherOf) {
        await ensureStaffAssignment(prisma, staffAssignments, {
          staffId: staffProfile.id,
          assignmentType: AssignmentType.CLASS_TEACHER,
          classArmId: req(
            arms[def.classTeacherOf],
            `class arm for ${def.classTeacherOf}`,
          ).id,
          academicSessionId: session.id,
        });
        classTeacherCount++;
        classTeacherUserIdByClassName[def.classTeacherOf] = teacherUser.id;
      }
    }
    logger.log(
      `${teacherDefs.length} teachers ready with subject assignments, ${classTeacherCount} also class teachers.`,
    );

    // -------------------------------------------------------------------
    // Parents + students
    // -------------------------------------------------------------------
    const superAdminId = superAdmin.id;
    async function ensureParent(firstName: string, lastName: string) {
      const user = await ensureRoleUser(prisma, invitations, {
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${EMAIL_DOMAIN}`,
        firstName,
        lastName,
        role: Role.PARENT,
        invitedByUserId: superAdminId,
      });
      return prisma.parentProfile.findUniqueOrThrow({ where: { userId: user.id } });
    }

    const parentAProfile = await ensureParent("Funmilayo", "Adebayo");
    const parentBProfile = await ensureParent("Michael", "Eze");
    const parentCProfile = await ensureParent("Aisha", "Lawal");
    const parentDProfile = await ensureParent("Chiamaka", "Nwankwo");
    // Parents E/F/H each guardian two students in different classes — some
    // households have more than one child enrolled (PRD: a parent may have
    // more than one student).
    const parentEProfile = await ensureParent("Olumide", "Bakare");
    const parentFProfile = await ensureParent("Amina", "Yusuf");
    const parentGProfile = await ensureParent("Grace", "Chukwu");
    const parentHProfile = await ensureParent("Chuka", "Obi");
    const parentIProfile = await ensureParent("Wale", "Adeyemi");
    const parentJProfile = await ensureParent("Musa", "Sani");
    const parentKProfile = await ensureParent("Folake", "Alabi");
    const parentLProfile = await ensureParent("Tunji", "Balogun");
    const parentMProfile = await ensureParent("Kunle", "Ogundele");
    const parentNProfile = await ensureParent("Ijeoma", "Okoro");
    logger.log("14 parents ready.");

    // 3 students per class arm (JSS 1 – SSS 3, 18 total). Every SSS student
    // carries a `department` — one ART/COMMERCIAL/SCIENCE student per SSS
    // class arm — consumed by the department-assignment + subject-opt-in
    // loop below; JSS students opt into every GENERAL elective instead
    // (no departments below SSS, PRD §3.2).
    // `key` is local seed-script bookkeeping only (map key below) — it is
    // never sent to the API or stored in the DB. Admission numbers are now
    // auto-generated by StudentService.create (YYYY/CC/NNNN).
    type StudentDef = {
      key: string;
      firstName: string;
      lastName: string;
      gender: Gender;
      className: string;
      parentProfileId: string;
      department?: DepartmentName;
    };
    const studentDefs: StudentDef[] = [
      // JSS 1
      { key: "david-adebayo", firstName: "David", lastName: "Adebayo", gender: Gender.MALE, className: "JSS 1", parentProfileId: parentAProfile.id },
      { key: "zainab-lawal", firstName: "Zainab", lastName: "Lawal", gender: Gender.FEMALE, className: "JSS 1", parentProfileId: parentCProfile.id },
      { key: "emeka-nwankwo", firstName: "Emeka", lastName: "Nwankwo", gender: Gender.MALE, className: "JSS 1", parentProfileId: parentDProfile.id },
      // JSS 2
      { key: "ade-bakare", firstName: "Ade", lastName: "Bakare", gender: Gender.MALE, className: "JSS 2", parentProfileId: parentEProfile.id },
      { key: "kemi-yusuf", firstName: "Kemi", lastName: "Yusuf", gender: Gender.FEMALE, className: "JSS 2", parentProfileId: parentFProfile.id },
      { key: "tobi-chukwu", firstName: "Tobi", lastName: "Chukwu", gender: Gender.MALE, className: "JSS 2", parentProfileId: parentGProfile.id },
      // JSS 3
      { key: "ifeanyi-obi", firstName: "Ifeanyi", lastName: "Obi", gender: Gender.MALE, className: "JSS 3", parentProfileId: parentHProfile.id },
      { key: "seun-adeyemi", firstName: "Seun", lastName: "Adeyemi", gender: Gender.MALE, className: "JSS 3", parentProfileId: parentIProfile.id },
      { key: "halima-sani", firstName: "Halima", lastName: "Sani", gender: Gender.FEMALE, className: "JSS 3", parentProfileId: parentJProfile.id },
      // SSS 1 — one student per department
      { key: "yetunde-bakare", firstName: "Yetunde", lastName: "Bakare", gender: Gender.FEMALE, className: "SSS 1", parentProfileId: parentEProfile.id, department: DepartmentName.ART },
      { key: "ngozi-obi", firstName: "Ngozi", lastName: "Obi", gender: Gender.FEMALE, className: "SSS 1", parentProfileId: parentHProfile.id, department: DepartmentName.COMMERCIAL },
      { key: "damilola-alabi", firstName: "Damilola", lastName: "Alabi", gender: Gender.FEMALE, className: "SSS 1", parentProfileId: parentKProfile.id, department: DepartmentName.SCIENCE },
      // SSS 2 — one student per department
      { key: "feyisayo-adebayo", firstName: "Feyisayo", lastName: "Adebayo", gender: Gender.FEMALE, className: "SSS 2", parentProfileId: parentAProfile.id, department: DepartmentName.ART },
      { key: "chinedu-eze", firstName: "Chinedu", lastName: "Eze", gender: Gender.MALE, className: "SSS 2", parentProfileId: parentBProfile.id, department: DepartmentName.COMMERCIAL },
      { key: "ronke-balogun", firstName: "Ronke", lastName: "Balogun", gender: Gender.FEMALE, className: "SSS 2", parentProfileId: parentLProfile.id, department: DepartmentName.SCIENCE },
      // SSS 3 — one student per department
      { key: "bimbo-ogundele", firstName: "Bimbo", lastName: "Ogundele", gender: Gender.FEMALE, className: "SSS 3", parentProfileId: parentMProfile.id, department: DepartmentName.ART },
      { key: "tayo-yusuf", firstName: "Tayo", lastName: "Yusuf", gender: Gender.MALE, className: "SSS 3", parentProfileId: parentFProfile.id, department: DepartmentName.COMMERCIAL },
      { key: "chukwuemeka-okoro", firstName: "Chukwuemeka", lastName: "Okoro", gender: Gender.MALE, className: "SSS 3", parentProfileId: parentNProfile.id, department: DepartmentName.SCIENCE },
    ];

    const studentIdByKey: Record<string, string> = {};
    for (const def of studentDefs) {
      const classArmId = req(arms[def.className], `class arm for ${def.className}`).id;
      // Idempotency check for re-runs: admissionNumber is no longer known
      // ahead of creation, so match on the (unique-enough, within this fixed
      // fixture list) name + class arm combo instead.
      let studentProfile = await prisma.studentProfile.findFirst({
        where: { currentClassId: classArmId, user: { firstName: def.firstName, lastName: def.lastName } },
      });
      if (!studentProfile) {
        studentProfile = await students.create({
          firstName: def.firstName,
          lastName: def.lastName,
          gender: def.gender,
          admissionDate: session.startDate,
          classArmId,
          guardians: [
            {
              existingParentProfileId: def.parentProfileId,
              relationship: GuardianRelationship.GUARDIAN,
              isPrimaryContact: true,
            },
          ],
        });
      } else {
        // Backfills gender on a re-run against a database seeded before this
        // field existed here — harmless no-op once the value already matches.
        await prisma.user.update({ where: { id: studentProfile.userId }, data: { gender: def.gender } });
      }
      studentIdByKey[def.key] = studentProfile.id;
    }
    logger.log(`${studentDefs.length} students ready (3+ per class, JSS 1 – SSS 3).`);

    // -------------------------------------------------------------------
    // SSS department assignment + GENERAL/DEPARTMENT subject opt-in, and
    // JSS's "every GENERAL elective" opt-in — enrollment itself is only
    // recorded against 1st Term (the only `isCurrent` term, same limitation
    // syncCompulsoryEnrollmentsOnClassAssignment already has), but the score
    // entries below cover all three terms regardless, since ScoreEntry has
    // no FK back to StudentSubjectEnrollment.
    //
    // Scores are entered as an Admin override (`isOverride: true`) so this
    // doesn't depend on any AssessmentComponent ever being opened — every
    // component seeded above is DRAFT, and nothing here calls forceOpen,
    // publishes a component, or generates/publishes a TermReportCard.
    // -------------------------------------------------------------------
    const seedRequestUser: RequestUser = { id: superAdmin.id, roles: [Role.SUPER_ADMIN], assignmentTypes: [] };
    const firstTermId = req(terms[0], "1st term").id;

    const componentsByTermCategory = new Map<string, { id: string; maxScore: number }[]>();
    for (const term of terms) {
      for (const category of [ClassLevelCategory.JSS, ClassLevelCategory.SSS]) {
        const rows = await prisma.assessmentComponent.findMany({
          where: { termId: term.id, classLevelCategory: category },
        });
        componentsByTermCategory.set(
          `${term.id}:${category}`,
          rows.map((r) => ({ id: r.id, maxScore: Number(r.maxScore) })),
        );
      }
    }

    // Deterministic pseudo-random *whole-number* score within [55%, 95%] of
    // a component's max — varied per student/subject/component but
    // reproducible, so a re-run (score entry is upserted) doesn't churn
    // values needlessly.
    function seededScore(seed: string, maxScore: number): number {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
      const ratio = 0.55 + ((hash % 1000) / 1000) * 0.4;
      return Math.round(maxScore * ratio);
    }

    // Same hash, used to deterministically pick one item from a fixed list
    // (a comment template, a skill rating value) per student/term/item.
    function seededPick<T>(seed: string, items: readonly T[]): T {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
      return req(items[hash % items.length], "seededPick item");
    }

    const skillItems = await prisma.skillAssessmentItem.findMany({
      where: { academicSessionId: session.id, isActive: true },
    });
    const SKILL_RATING_VALUES: SkillRatingValue[] = [
      SkillRatingValue.EXCELLENT,
      SkillRatingValue.VERY_GOOD,
      SkillRatingValue.GOOD,
      SkillRatingValue.FAIR,
      SkillRatingValue.POOR,
    ];
    const CLASS_TEACHER_COMMENT_TEMPLATES = [
      "{name} has shown consistent improvement this term and participates actively in class.",
      "{name} is diligent and works well with classmates — keep up the good attitude to schoolwork.",
      "A pleasant term overall; {name} should pay closer attention to punctuality and homework completion.",
      "{name} demonstrates strong potential — more consistency with class assignments will help going forward.",
      "{name} has been attentive and cooperative this term, with steady progress across subjects.",
    ];
    const PRINCIPAL_COMMENT_TEMPLATES = [
      "A commendable term. Keep up the good work.",
      "Good result — there is room for improvement in a few areas.",
      "Impressive performance this term. Well done.",
      "Satisfactory result overall. Greater effort is encouraged next term.",
      "A solid term's work. Continued diligence will bring even better results.",
    ];

    let enrollmentCount = 0;
    let scoreEntryCount = 0;
    let commentCount = 0;
    let skillRatingCount = 0;
    for (const def of studentDefs) {
      const studentId = req(studentIdByKey[def.key], `student id for ${def.key}`);
      const armInfo = req(arms[def.className], `class arm for ${def.className}`);
      const classArmId = armInfo.id;

      let compulsoryCodes: string[];
      let electiveCodes: string[];
      if (armInfo.category === ClassLevelCategory.JSS) {
        compulsoryCodes = ["ENG", "MTH", "BST", "NVE", "PVS", "BUS", "CRS"];
        electiveCodes = JSS_GENERAL_CODES;
      } else {
        compulsoryCodes = ["ENG", "MTH"];
        const department = req(def.department, `department for ${def.firstName} ${def.lastName}`);
        const existingDept = await prisma.studentDepartment.findUnique({
          where: { studentId_academicSessionId: { studentId, academicSessionId: session.id } },
        });
        if (!existingDept) {
          await studentDepartments.create({
            studentId,
            departmentId: req(departmentIds[department], `department id for ${department}`),
            academicSessionId: session.id,
          });
        }
        electiveCodes = sssElectiveCodesFor(department, def.className);
      }

      for (const code of electiveCodes) {
        await subjectEnrollments.enroll({
          studentId,
          subjectId: req(subjectIdByCode[code], `subject id for ${code}`),
          classArmId,
          academicSessionId: session.id,
          termId: firstTermId,
        });
        enrollmentCount++;
      }

      const scoreableSubjectIds = [
        ...compulsoryCodes.flatMap(scoreableSubjectIdsForCode),
        ...electiveCodes.flatMap(scoreableSubjectIdsForCode),
      ];

      const classTeacherUserId = req(
        classTeacherUserIdByClassName[def.className],
        `class teacher user id for ${def.className}`,
      );

      for (const term of terms) {
        const components = req(
          componentsByTermCategory.get(`${term.id}:${armInfo.category}`),
          `assessment components for ${term.name}/${armInfo.category}`,
        );
        for (const subjectId of scoreableSubjectIds) {
          for (const component of components) {
            await scoreEntries.enter(
              {
                studentId,
                subjectId,
                assessmentComponentId: component.id,
                classArmId,
                score: seededScore(`${studentId}:${subjectId}:${component.id}`, component.maxScore),
              },
              seedRequestUser,
              true,
            );
            scoreEntryCount++;
          }
        }

        // Written as an override so it doesn't depend on the ReportWindow
        // being OPEN, but with the real class teacher's/principal's user id
        // (not superAdmin) so authorStaffId resolves to their actual
        // StaffProfile — same "real service, real author" shape as the
        // score entries above, minus the date gate.
        await reportComments.write(
          {
            studentId,
            termId: term.id,
            commentType: ReportCommentType.CLASS_TEACHER,
            comment: seededPick(`${studentId}:${term.id}:ct`, CLASS_TEACHER_COMMENT_TEMPLATES).replace(
              "{name}",
              def.firstName,
            ),
          },
          { id: classTeacherUserId, roles: ["STAFF"], assignmentTypes: ["CLASS_TEACHER"] },
          true,
        );
        await reportComments.write(
          {
            studentId,
            termId: term.id,
            commentType: ReportCommentType.PRINCIPAL,
            comment: seededPick(`${studentId}:${term.id}:pr`, PRINCIPAL_COMMENT_TEMPLATES),
          },
          { id: principalUser.id, roles: ["STAFF"], assignmentTypes: ["PRINCIPAL"] },
          true,
        );
        commentCount += 2;

        for (const item of skillItems) {
          await skillRatings.rate(
            {
              studentId,
              termId: term.id,
              skillAssessmentItemId: item.id,
              rating: seededPick(`${studentId}:${term.id}:${item.id}`, SKILL_RATING_VALUES),
            },
            { id: classTeacherUserId, roles: ["STAFF"], assignmentTypes: ["CLASS_TEACHER"] },
            true,
          );
          skillRatingCount++;
        }
      }
    }
    logger.log(`Departments + subject opt-ins ready (${enrollmentCount} GENERAL/DEPARTMENT enrollments).`);
    logger.log(
      `Score entries ready: ${scoreEntryCount} rows across ${terms.length} terms (every component left DRAFT/unpublished).`,
    );
    logger.log(
      `Report comments ready: ${commentCount} rows (class-teacher + principal, per student per term).`,
    );
    logger.log(`Skill ratings ready: ${skillRatingCount} rows (every active skill item, per student per term).`);

    // -------------------------------------------------------------------
    // Fee structures + invoices — 1st Term only (Xmas Cantata wouldn't
    // recur in 2nd/3rd Term, and the school's 1st Term runs Sept-Dec,
    // ending right around Christmas). Tuition is level-scoped: JSS's three
    // levels each get their own ₦35,000 row and SSS's three get their own
    // ₦50,000 row rather than one row covering the category (FeeStructure.
    // classLevels — a FeeStructureClassLevel join — could cover a whole
    // category in one row, but this seed data predates that generalization
    // and there's no need to collapse it). PTA Levy and Xmas Cantata are
    // school-wide (classLevelIds omitted); Extra Classes is scoped to
    // JSS 3 and SSS 3 only. Xmas Cantata is the only isMandatory: false
    // row — a student opts into it via FeeStructureStudentAssignmentService
    // (Bursar-recorded) rather than it landing on every invoice.
    // -------------------------------------------------------------------
    const firstTerm = req(terms[0], "1st term");
    const feeStructureDefs: {
      name: string;
      amount: number;
      classLevelIds?: string[];
      isMandatory: boolean;
    }[] = [
      { name: "Tuition", amount: 35000, classLevelIds: [req(arms["JSS 1"], "class arm for JSS 1").classLevelId], isMandatory: true },
      { name: "Tuition", amount: 35000, classLevelIds: [req(arms["JSS 2"], "class arm for JSS 2").classLevelId], isMandatory: true },
      { name: "Tuition", amount: 35000, classLevelIds: [req(arms["JSS 3"], "class arm for JSS 3").classLevelId], isMandatory: true },
      { name: "Tuition", amount: 50000, classLevelIds: [req(arms["SSS 1"], "class arm for SSS 1").classLevelId], isMandatory: true },
      { name: "Tuition", amount: 50000, classLevelIds: [req(arms["SSS 2"], "class arm for SSS 2").classLevelId], isMandatory: true },
      { name: "Tuition", amount: 50000, classLevelIds: [req(arms["SSS 3"], "class arm for SSS 3").classLevelId], isMandatory: true },
      { name: "PTA Levy", amount: 5000, isMandatory: true },
      { name: "Extra Classes", amount: 15000, classLevelIds: [req(arms["JSS 3"], "class arm for JSS 3").classLevelId], isMandatory: true },
      { name: "Extra Classes", amount: 15000, classLevelIds: [req(arms["SSS 3"], "class arm for SSS 3").classLevelId], isMandatory: true },
      { name: "Xmas Cantata", amount: 10000, isMandatory: false },
    ];
    for (const def of feeStructureDefs) {
      const existing = await prisma.feeStructure.findFirst({
        where: {
          termId: firstTerm.id,
          name: def.name,
          classLevels: def.classLevelIds?.length
            ? { some: { classLevelId: { in: def.classLevelIds } } }
            : { none: {} },
        },
      });
      if (existing) continue;
      await feeStructures.create({
        termId: firstTerm.id,
        academicSessionId: session.id,
        classLevelIds: def.classLevelIds,
        name: def.name,
        amount: def.amount,
        isMandatory: def.isMandatory,
      });
    }
    logger.log(`Fee structures ready: ${feeStructureDefs.length} rows for ${firstTerm.name}.`);

    const invoiceResult = await invoices.generate({
      termId: firstTerm.id,
      dueDate: new Date("2026-09-28"),
    });
    logger.log(
      `Invoices ready: ${invoiceResult.created} created, ${invoiceResult.alreadyInvoiced} already invoiced, ${invoiceResult.noApplicableFees} skipped (no applicable fees).`,
    );

    // -------------------------------------------------------------------
    // Payment gateway configs — PaymentGatewayCredentialsService reads its
    // row from the DB (PaymentGatewayConfig), not straight from env, so
    // MONNIFY_*/PAYSTACK_* being set in .env alone doesn't make checkout
    // work; a row has to exist for whichever provider PAYMENT_GATEWAY_PROVIDER
    // selects. Seed both providers when their env credentials are present
    // so switching PAYMENT_GATEWAY_PROVIDER doesn't need a re-seed.
    // -------------------------------------------------------------------
    const gatewayConfigDefs: {
      provider: "MONNIFY" | "PAYSTACK";
      apiKey?: string;
      secretKey?: string;
      contractCode?: string;
      environment?: "SANDBOX" | "LIVE";
    }[] = [
      {
        provider: "MONNIFY",
        apiKey: process.env.MONNIFY_API_KEY,
        secretKey: process.env.MONNIFY_SECRET_KEY,
        contractCode: process.env.MONNIFY_CONTRACT_CODE,
        environment: process.env.MONNIFY_ENV as "SANDBOX" | "LIVE" | undefined,
      },
      {
        provider: "PAYSTACK",
        apiKey: process.env.PAYSTACK_PUBLIC_KEY,
        secretKey: process.env.PAYSTACK_SECRET_KEY,
      },
    ];
    for (const def of gatewayConfigDefs) {
      if (!def.apiKey || !def.secretKey) continue;
      const existing = await prisma.paymentGatewayConfig.findUnique({ where: { provider: def.provider } });
      if (existing) continue;
      await paymentGatewayConfigs.create({
        provider: def.provider,
        apiKey: def.apiKey,
        secretKey: def.secretKey,
        contractCode: def.contractCode,
        environment: def.environment ?? "SANDBOX",
        isActive: true,
      });
      logger.log(`Payment gateway config seeded for ${def.provider}.`);
    }

    logger.log(`Done. Every seeded account's password is "${DEMO_PASSWORD}".`);
  } finally {
    await app.close();
  }
}

async function upsertAcademicSession(
  prisma: PrismaService,
  data: { name: string; startDate: Date; endDate: Date },
) {
  return prisma.academicSession.upsert({
    where: { name: data.name },
    update: {},
    create: { ...data, isCurrent: true },
  });
}

/** Splits a term's date range into 4 equal-length [opensAt, closesAt) windows, one per assessment component. */
function quarterWindows(
  start: Date,
  end: Date,
): { opensAt: Date; closesAt: Date }[] {
  const step = (end.getTime() - start.getTime()) / 4;
  return [0, 1, 2, 3].map((i) => ({
    opensAt: new Date(start.getTime() + i * step),
    closesAt: new Date(start.getTime() + (i + 1) * step),
  }));
}

async function upsertTerm(
  prisma: PrismaService,
  academicSessionId: string,
  data: { name: string; startDate: Date; endDate: Date },
  isCurrent: boolean,
) {
  return prisma.term.upsert({
    where: { academicSessionId_name: { academicSessionId, name: data.name } },
    update: {},
    create: { ...data, academicSessionId, isCurrent },
  });
}

async function upsertClassSubject(
  prisma: PrismaService,
  data: {
    classLevelCategory: ClassLevelCategory;
    subjectId: string;
    type: SubjectType;
    departmentId?: string;
    periodsPerWeek?: number;
    concurrencyGroupId?: string;
  },
) {
  return prisma.classSubject.upsert({
    where: {
      classLevelCategory_subjectId: {
        classLevelCategory: data.classLevelCategory,
        subjectId: data.subjectId,
      },
    },
    // Applies periodsPerWeek/concurrencyGroupId on a re-run too (unlike the
    // old no-op update) — every other field here is structural (type/
    // department rarely change once seeded) but these two are exactly the
    // kind of tuning this script exists to keep in sync with.
    update: {
      type: data.type,
      departmentId: data.departmentId,
      periodsPerWeek: data.periodsPerWeek,
      concurrencyGroupId: data.concurrencyGroupId,
    },
    create: data,
  });
}

/**
 * Find-then-create (no unique constraint on name+classLevelCategory to
 * upsert against, same as this file's other lookup-catalogue helpers, e.g.
 * simpleSubjectDefs' find-then-create loop above) for a
 * ClassSubjectConcurrencyGroup — an "options column" of subjects scheduled
 * at the same slot/day instead of each reserving separate weekly capacity.
 */
async function ensureConcurrencyGroup(prisma: PrismaService, name: string, classLevelCategory: ClassLevelCategory) {
  const existing = await prisma.classSubjectConcurrencyGroup.findFirst({ where: { name, classLevelCategory } });
  if (existing) return existing;
  return prisma.classSubjectConcurrencyGroup.create({ data: { name, classLevelCategory } });
}

/**
 * Creates (or reuses) a User with the given role via the real
 * invite-then-accept path (InvitationService.createInTx + accept), setting
 * the shared demo password instead of sending a real email — same profile
 * shell + role-grant logic a real acceptance produces, just without the
 * round-trip.
 */
async function ensureRoleUser(
  prisma: PrismaService,
  invitations: InvitationService,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    staffCategory?: StaffCategory;
    invitedByUserId: string;
  },
): Promise<{ id: string; email: string }> {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { roles: true },
  });
  if (existing?.roles.some((r) => r.role === input.role && r.isActive)) {
    return { id: existing.id, email: existing.email };
  }

  const { rawToken, userId } = await prisma.$transaction((tx) =>
    invitations.createInTx(tx, {
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      invitedRole: input.role,
      staffCategory: input.staffCategory,
      invitedByUserId: input.invitedByUserId,
    }),
  );
  const user = await invitations.accept(rawToken, DEMO_PASSWORD);
  return { id: userId, email: user.email };
}

async function ensureStaffAssignment(
  prisma: PrismaService,
  staffAssignments: StaffAssignmentService,
  data: {
    staffId: string;
    assignmentType: AssignmentType;
    subjectId?: string;
    classArmId?: string;
    academicSessionId: string;
  },
) {
  const existing = await prisma.staffAssignment.findFirst({
    where: {
      staffId: data.staffId,
      assignmentType: data.assignmentType,
      subjectId: data.subjectId ?? null,
      classArmId: data.classArmId ?? null,
      academicSessionId: data.academicSessionId,
      isActive: true,
    },
  });
  if (existing) return existing;
  return staffAssignments.create(data);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
