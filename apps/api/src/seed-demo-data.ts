import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as argon2 from "argon2";
import {
  AssessmentComponentType,
  AssignmentType,
  ClassLevelCategory,
  DepartmentName,
  GuardianRelationship,
  Role,
  SkillCategory,
  StaffCategory,
  SubjectType,
} from "@prisma/client";
import { AppModule } from "./app.module";
import { PrismaService } from "./prisma/prisma.service";
import { InvitationService } from "./identity/invitations/invitation.service";
import { StudentService } from "./identity/students/student";
import { SubjectService } from "./subjects/subject";
import { StaffAssignmentService } from "./staff-assignments/staff-assignment";
import { AssessmentComponentService } from "./assessments/assessment-component";
import { ReportWindowService } from "./assessments/report-window";
import { FeeStructureService } from "./fees/fee-structure";
import { InvoiceService } from "./fees/invoice";
import { PaymentGatewayConfigService } from "./fees/gateway/payment-gateway-config";

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
  const staffAssignments = app.get(StaffAssignmentService);
  const assessmentComponents = app.get(AssessmentComponentService);
  const reportWindows = app.get(ReportWindowService);
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
      await upsertClassSubject(prisma, {
        classLevelCategory: ClassLevelCategory.JSS,
        subjectId: req(subjectIdByCode[cs.code], `subject id for ${cs.code}`),
        type: cs.type,
      });
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
    for (const cs of sssClassSubjects) {
      await upsertClassSubject(prisma, {
        classLevelCategory: ClassLevelCategory.SSS,
        subjectId: req(subjectIdByCode[cs.code], `subject id for ${cs.code}`),
        type: cs.type,
        departmentId: cs.department
          ? req(
              departmentIds[cs.department],
              `department id for ${cs.department}`,
            )
          : undefined,
      });
    }
    logger.log("Class-subject applicability ready.");

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
    // 16 teachers, max 2 subjects each — covers all 32 of the catalogue's
    // assignable (non-group-parent) subjects.
    // -------------------------------------------------------------------
    const SCOPE: Record<string, "JSS_ONLY" | "SSS_ONLY" | "BOTH"> = {
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
      // Both — carries over from JSS to SSS (AGR as an optional elective,
      // not department-restricted; YOR as SSS's ART-department elective;
      // see the sssClassSubjects comment above). ENG's own two children
      // stand in for the ENG group parent, which (like BST/PVS/CCA/NVE) is
      // never directly assignable.
      "ENG-01": "BOTH",
      "ENG-02": "BOTH",
      MTH: "BOTH",
      CRS: "BOTH",
      AGR: "BOTH",
      YOR: "BOTH",
    };
    const armCounters = { JSS_ONLY: 0, SSS_ONLY: 0, BOTH: 0 };
    function armForSubject(code: string): string {
      const scope = SCOPE[code];
      if (scope === "JSS_ONLY")
        return req(
          jssArmIds[armCounters.JSS_ONLY++ % jssArmIds.length],
          "JSS arm id",
        );
      if (scope === "SSS_ONLY")
        return req(
          sssArmIds[armCounters.SSS_ONLY++ % sssArmIds.length],
          "SSS arm id",
        );
      return req(
        jssArmIds[armCounters.BOTH++ % jssArmIds.length],
        "JSS arm id",
      );
    }

    // `classTeacherOf` (a key into `arms`, e.g. "JSS 1") is only set for the
    // six teachers doubling as their class's CLASS_TEACHER — chosen from
    // among whoever already has a SUBJECT_TEACHER presence in that exact
    // arm (traceable via armForSubject's round-robin above), so the pairing
    // reads as a real teacher's real class, not an arbitrary assignment.
    const teacherDefs: {
      firstName: string;
      lastName: string;
      subjectCodes: string[];
      classTeacherOf?: string;
    }[] = [
      {
        firstName: "Chidinma",
        lastName: "Eze",
        subjectCodes: ["ENG-01", "ENG-02"],
      },
      { firstName: "Tunde", lastName: "Afolabi", subjectCodes: ["MTH", "FMT"] },
      { firstName: "Ngozi", lastName: "Umeh", subjectCodes: ["BSC", "PHY"] },
      { firstName: "Bola", lastName: "Adeyemi", subjectCodes: ["BTN", "CHM"] },
      { firstName: "Fatima", lastName: "Sule", subjectCodes: ["IT", "BIO"] },
      {
        firstName: "Kelechi",
        lastName: "Obi",
        subjectCodes: ["PHE", "AGR"],
        classTeacherOf: "JSS 1",
      },
      {
        firstName: "Amaka",
        lastName: "Nwachukwu",
        subjectCodes: ["SOS", "GEO"],
        classTeacherOf: "JSS 2",
      },
      {
        firstName: "Yusuf",
        lastName: "Abdullahi",
        subjectCodes: ["SEC", "ECO"],
        classTeacherOf: "JSS 3",
      },
      {
        firstName: "Blessing",
        lastName: "Etim",
        subjectCodes: ["HEC", "COM"],
        classTeacherOf: "SSS 1",
      },
      { firstName: "Ibrahim", lastName: "Musa", subjectCodes: ["BUS", "DPS"] },
      {
        firstName: "Peter",
        lastName: "Okafor",
        subjectCodes: ["GOV", "LIT"],
        classTeacherOf: "SSS 3",
      },
      { firstName: "Halima", lastName: "Bello", subjectCodes: ["FRE", "CRS"] },
      { firstName: "Adaeze", lastName: "Uche", subjectCodes: ["YOR", "CIV"] },
      { firstName: "Segun", lastName: "Alabi", subjectCodes: ["MUS", "CRA"] },
      {
        firstName: "Chioma",
        lastName: "Nnaji",
        subjectCodes: ["ACC", "CIVS"],
        classTeacherOf: "SSS 2",
      },
      { firstName: "David", lastName: "Osagie", subjectCodes: ["MKT", "FNU"] },
    ];

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
      for (const code of def.subjectCodes) {
        await ensureStaffAssignment(prisma, staffAssignments, {
          staffId: staffProfile.id,
          assignmentType: AssignmentType.SUBJECT_TEACHER,
          subjectId: subjectIdByCode[code],
          classArmId: armForSubject(code),
          academicSessionId: session.id,
        });
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
      }
    }
    logger.log(
      `${teacherDefs.length} teachers ready with subject assignments, ${classTeacherCount} also class teachers.`,
    );

    // -------------------------------------------------------------------
    // Parents + students
    // -------------------------------------------------------------------
    const parentAUser = await ensureRoleUser(prisma, invitations, {
      email: `funmilayo.adebayo@${EMAIL_DOMAIN}`,
      firstName: "Funmilayo",
      lastName: "Adebayo",
      role: Role.PARENT,
      invitedByUserId: superAdmin.id,
    });
    const parentBUser = await ensureRoleUser(prisma, invitations, {
      email: `michael.eze@${EMAIL_DOMAIN}`,
      firstName: "Michael",
      lastName: "Eze",
      role: Role.PARENT,
      invitedByUserId: superAdmin.id,
    });
    const parentCUser = await ensureRoleUser(prisma, invitations, {
      email: `aisha.lawal@${EMAIL_DOMAIN}`,
      firstName: "Aisha",
      lastName: "Lawal",
      role: Role.PARENT,
      invitedByUserId: superAdmin.id,
    });
    const parentDUser = await ensureRoleUser(prisma, invitations, {
      email: `chiamaka.nwankwo@${EMAIL_DOMAIN}`,
      firstName: "Chiamaka",
      lastName: "Nwankwo",
      role: Role.PARENT,
      invitedByUserId: superAdmin.id,
    });
    const parentAProfile = await prisma.parentProfile.findUniqueOrThrow({
      where: { userId: parentAUser.id },
    });
    const parentBProfile = await prisma.parentProfile.findUniqueOrThrow({
      where: { userId: parentBUser.id },
    });
    const parentCProfile = await prisma.parentProfile.findUniqueOrThrow({
      where: { userId: parentCUser.id },
    });
    const parentDProfile = await prisma.parentProfile.findUniqueOrThrow({
      where: { userId: parentDUser.id },
    });
    logger.log("4 parents ready.");

    const studentDefs = [
      {
        admissionNumber: "DYCC/2026/0001",
        firstName: "David",
        lastName: "Adebayo",
        classArmId: req(arms["JSS 1"], "class arm for JSS 1").id,
        parentProfileId: parentAProfile.id,
      },
      {
        admissionNumber: "DYCC/2026/0002",
        firstName: "Feyisayo",
        lastName: "Adebayo",
        classArmId: req(arms["SSS 2"], "class arm for SSS 2").id,
        parentProfileId: parentAProfile.id,
      },
      {
        admissionNumber: "DYCC/2026/0003",
        firstName: "Chinedu",
        lastName: "Eze",
        classArmId: req(arms["SSS 2"], "class arm for SSS 2").id,
        parentProfileId: parentBProfile.id,
      },
      {
        admissionNumber: "DYCC/2026/0004",
        firstName: "Zainab",
        lastName: "Lawal",
        classArmId: req(arms["JSS 1"], "class arm for JSS 1").id,
        parentProfileId: parentCProfile.id,
      },
      {
        admissionNumber: "DYCC/2026/0005",
        firstName: "Emeka",
        lastName: "Nwankwo",
        classArmId: req(arms["JSS 1"], "class arm for JSS 1").id,
        parentProfileId: parentDProfile.id,
      },
    ];

    for (const def of studentDefs) {
      const existing = await prisma.studentProfile.findUnique({
        where: { admissionNumber: def.admissionNumber },
      });
      if (existing) continue;
      await students.create({
        firstName: def.firstName,
        lastName: def.lastName,
        admissionNumber: def.admissionNumber,
        admissionDate: session.startDate,
        classArmId: def.classArmId,
        guardians: [
          {
            existingParentProfileId: def.parentProfileId,
            relationship: GuardianRelationship.GUARDIAN,
            isPrimaryContact: true,
          },
        ],
      });
    }
    logger.log(`${studentDefs.length} students ready.`);

    // -------------------------------------------------------------------
    // Fee structures + invoices — 1st Term only (Xmas Cantata wouldn't
    // recur in 2nd/3rd Term, and the school's 1st Term runs Sept-Dec,
    // ending right around Christmas). Tuition is level-scoped: since
    // FeeStructure.classLevelId targets one specific ClassLevel (not a
    // whole JSS/SSS category), JSS's three levels each get their own
    // ₦35,000 row and SSS's three get their own ₦50,000 row rather than
    // one row covering the category. PTA Levy and Xmas Cantata are
    // school-wide (classLevelId omitted); Extra Classes is scoped to
    // JSS 3 and SSS 3 only. Xmas Cantata is the only isMandatory: false
    // row — informational today, since InvoiceService.generate() doesn't
    // actually filter by isMandatory (every applicable FeeStructure row
    // lands on the invoice regardless of it), but it records the intended
    // optional/mandatory distinction as data.
    // -------------------------------------------------------------------
    const firstTerm = req(terms[0], "1st term");
    const feeStructureDefs: {
      name: string;
      amount: number;
      classLevelId?: string;
      isMandatory: boolean;
    }[] = [
      { name: "Tuition", amount: 35000, classLevelId: req(arms["JSS 1"], "class arm for JSS 1").classLevelId, isMandatory: true },
      { name: "Tuition", amount: 35000, classLevelId: req(arms["JSS 2"], "class arm for JSS 2").classLevelId, isMandatory: true },
      { name: "Tuition", amount: 35000, classLevelId: req(arms["JSS 3"], "class arm for JSS 3").classLevelId, isMandatory: true },
      { name: "Tuition", amount: 50000, classLevelId: req(arms["SSS 1"], "class arm for SSS 1").classLevelId, isMandatory: true },
      { name: "Tuition", amount: 50000, classLevelId: req(arms["SSS 2"], "class arm for SSS 2").classLevelId, isMandatory: true },
      { name: "Tuition", amount: 50000, classLevelId: req(arms["SSS 3"], "class arm for SSS 3").classLevelId, isMandatory: true },
      { name: "PTA Levy", amount: 5000, isMandatory: true },
      { name: "Extra Classes", amount: 15000, classLevelId: req(arms["JSS 3"], "class arm for JSS 3").classLevelId, isMandatory: true },
      { name: "Extra Classes", amount: 15000, classLevelId: req(arms["SSS 3"], "class arm for SSS 3").classLevelId, isMandatory: true },
      { name: "Xmas Cantata", amount: 10000, isMandatory: false },
    ];
    for (const def of feeStructureDefs) {
      const existing = await prisma.feeStructure.findFirst({
        where: { termId: firstTerm.id, classLevelId: def.classLevelId ?? null, name: def.name },
      });
      if (existing) continue;
      await feeStructures.create({
        termId: firstTerm.id,
        academicSessionId: session.id,
        classLevelId: def.classLevelId,
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
  },
) {
  return prisma.classSubject.upsert({
    where: {
      classLevelCategory_subjectId: {
        classLevelCategory: data.classLevelCategory,
        subjectId: data.subjectId,
      },
    },
    update: {},
    create: data,
  });
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
