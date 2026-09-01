import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as argon2 from "argon2";
import {
  AssignmentType,
  ClassLevelCategory,
  DepartmentName,
  Gender,
  GuardianRelationship,
  Role,
  StaffCategory,
  SubjectType,
} from "@prisma/client";
import { AppModule } from "./app.module";
import { PrismaService } from "./prisma/prisma.service";
import { InvitationService } from "./identity/invitations/invitation.service";
import { StudentService } from "./identity/students/student";
import { SubjectService } from "./subjects/subject";
import { StudentSubjectEnrollmentService } from "./subjects/student-subject-enrollment";
import { StudentDepartmentService } from "./academic-structure/student-department";
import { StaffAssignmentService } from "./staff-assignments/staff-assignment";
import { FeeStructureService } from "./fees/fee-structure";
import { InvoiceService } from "./fees/invoice";

/**
 * A second, smaller demo dataset — same "real services, not raw inserts"
 * shape as seed-demo-data.ts, but deliberately narrower: nine classes
 * (Basic 1-3 / JSS 1-3 / SSS 1-3), one arm each, 5 students per arm, no
 * teachers and no scores/report-cards/skill-ratings (so no assessment
 * components, report windows, or grade scale either — none of that has any
 * reader without a score to attach to). Useful for exercising the
 * class/subject/fee/student slice of the app without the full 18-teacher,
 * 32-subject catalogue of the other script.
 *
 * Run after `pnpm setup:school` has created the SchoolProfile + Super-Admin,
 * same precondition as seed-demo-data.ts. Safe-ish to re-run (check-before-
 * create throughout) but, like its sibling, hasn't been exercised as
 * thoroughly on re-run as setup-school.ts.
 *
 * Usage: pnpm --filter=@school/api run seed:demo:lite
 */

const DEMO_PASSWORD = "12345678";
const EMAIL_DOMAIN = "brightpath.test";

/** Non-null lookup for the internal lookup maps below — every key used is a
 * literal defined earlier in this same script, so a miss means a typo here,
 * not bad input worth handling gracefully. */
function req<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

async function main() {
  const logger = new Logger("seed:demo:lite");
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
  const feeStructures = app.get(FeeStructureService);
  const invoices = app.get(InvoiceService);

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
    // Academic session + terms (2026/2027 — same calendar as the other demo
    // script, so the two can share a database without date drift).
    // -------------------------------------------------------------------
    const session = await upsertAcademicSession(prisma, {
      name: "2026/2027",
      startDate: new Date("2026-09-14"),
      endDate: new Date("2027-07-16"),
    });
    logger.log(`Academic session "${session.name}" ready.`);

    const termDefs = [
      { name: "1st Term", startDate: new Date("2026-09-14"), endDate: new Date("2026-12-18") },
      { name: "2nd Term", startDate: new Date("2027-01-11"), endDate: new Date("2027-04-30") },
      { name: "3rd Term", startDate: new Date("2027-05-10"), endDate: new Date("2027-07-16") },
    ];
    const terms = [];
    for (const [i, def] of termDefs.entries()) {
      terms.push(await upsertTerm(prisma, session.id, def, i === 0));
    }
    logger.log(`Terms ready: ${terms.map((t) => t.name).join(", ")}.`);
    const firstTerm = req(terms[0], "1st term");

    // -------------------------------------------------------------------
    // Class levels + single arm each ("A" — every level has exactly one arm
    // in this dataset, unlike the multi-arm full demo).
    // -------------------------------------------------------------------
    const levelDefs = [
      { name: "Basic 1", order: 1, category: ClassLevelCategory.PRIMARY },
      { name: "Basic 2", order: 2, category: ClassLevelCategory.PRIMARY },
      { name: "Basic 3", order: 3, category: ClassLevelCategory.PRIMARY },
      { name: "JSS 1", order: 4, category: ClassLevelCategory.JSS },
      { name: "JSS 2", order: 5, category: ClassLevelCategory.JSS },
      { name: "JSS 3", order: 6, category: ClassLevelCategory.JSS },
      { name: "SSS 1", order: 7, category: ClassLevelCategory.SSS },
      { name: "SSS 2", order: 8, category: ClassLevelCategory.SSS },
      { name: "SSS 3", order: 9, category: ClassLevelCategory.SSS },
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
          data: { classLevelId: level.id, academicSessionId: session.id, name: "A" },
        });
      }
      arms[def.name] = { id: arm.id, classLevelId: level.id, category: def.category };
    }
    logger.log(`Class levels + arms ready: ${Object.keys(arms).join(", ")}.`);

    // -------------------------------------------------------------------
    // Departments (SSS only — needed for Chemistry/Commerce/CRS below).
    // -------------------------------------------------------------------
    const departmentIds: Record<DepartmentName, string> = {} as Record<DepartmentName, string>;
    for (const name of [DepartmentName.SCIENCE, DepartmentName.COMMERCIAL, DepartmentName.ART]) {
      const dept = await prisma.department.upsert({ where: { name }, update: {}, create: { name } });
      departmentIds[name] = dept.id;
    }

    // -------------------------------------------------------------------
    // Subject catalogue.
    //
    // English Language is one grouped subject shared across all three
    // categories (Oral and Essay / Summary and Comprehension children),
    // same PRD §3.3 shape as the full demo's grouped subjects. Mathematics
    // is one plain Subject row reused across all three categories too — a
    // Subject only becomes category-specific via the ClassSubject row that
    // applies it, same pattern seed-demo-data.ts uses for MTH across JSS/SSS.
    // -------------------------------------------------------------------
    const simpleSubjectDefs: { code: string; name: string; requiresCalculation?: boolean }[] = [
      { code: "MTH", name: "Mathematics", requiresCalculation: true },
      { code: "QR", name: "Quantitative Reasoning" },
      { code: "CHM", name: "Chemistry", requiresCalculation: true },
      { code: "COM", name: "Commerce" },
      { code: "CRS", name: "Christian Religious Studies" },
    ];
    const subjectIdByCode: Record<string, string> = {};
    for (const def of simpleSubjectDefs) {
      const existing = await prisma.subject.findUnique({ where: { code: def.code } });
      const row =
        existing ??
        (await subjects.create({
          name: def.name,
          code: def.code,
          requiresCalculation: def.requiresCalculation ?? false,
        }));
      subjectIdByCode[def.code] = row.id;
    }

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

    // National Value Education (JSS only) — general, not compulsory, per
    // this dataset's brief: Social Studies, Security Education, Civic
    // Education combine into one taught/scored group, same shape as the
    // full demo's NVE, just GENERAL here instead of COMPULSORY (below).
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
    logger.log(`Subject catalogue ready: ${Object.keys(subjectIdByCode).length} subjects.`);

    // -------------------------------------------------------------------
    // Class-subject applicability.
    //
    // Primary: English + Mathematics compulsory, Quantitative Reasoning
    // general. JSS: English + Mathematics compulsory, NVE general. SSS:
    // English + Mathematics compulsory, Chemistry/Commerce/Christian
    // Religious Studies departmental (Science/Commercial/Art respectively).
    // -------------------------------------------------------------------
    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.PRIMARY,
      subjectId: subjectIdByCode.ENG,
      type: SubjectType.COMPULSORY,
    });
    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.PRIMARY,
      subjectId: req(subjectIdByCode.MTH, "subject id for MTH"),
      type: SubjectType.COMPULSORY,
    });
    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.PRIMARY,
      subjectId: req(subjectIdByCode.QR, "subject id for QR"),
      type: SubjectType.GENERAL,
    });

    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.JSS,
      subjectId: subjectIdByCode.ENG,
      type: SubjectType.COMPULSORY,
    });
    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.JSS,
      subjectId: req(subjectIdByCode.MTH, "subject id for MTH"),
      type: SubjectType.COMPULSORY,
    });
    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.JSS,
      subjectId: subjectIdByCode.NVE,
      type: SubjectType.GENERAL,
    });

    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.SSS,
      subjectId: subjectIdByCode.ENG,
      type: SubjectType.COMPULSORY,
    });
    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.SSS,
      subjectId: req(subjectIdByCode.MTH, "subject id for MTH"),
      type: SubjectType.COMPULSORY,
    });
    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.SSS,
      subjectId: req(subjectIdByCode.CHM, "subject id for CHM"),
      type: SubjectType.DEPARTMENT,
      departmentId: departmentIds[DepartmentName.SCIENCE],
    });
    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.SSS,
      subjectId: req(subjectIdByCode.COM, "subject id for COM"),
      type: SubjectType.DEPARTMENT,
      departmentId: departmentIds[DepartmentName.COMMERCIAL],
    });
    await upsertClassSubject(prisma, {
      classLevelCategory: ClassLevelCategory.SSS,
      subjectId: req(subjectIdByCode.CRS, "subject id for CRS"),
      type: SubjectType.DEPARTMENT,
      departmentId: departmentIds[DepartmentName.ART],
    });
    logger.log("Class-subject applicability ready.");

    // The SSS departmental subject each department's students opt into —
    // exactly one per department in this dataset (unlike the full demo's
    // multi-subject department elective lists).
    const DEPARTMENT_SUBJECT_CODE: Record<DepartmentName, string> = {
      [DepartmentName.SCIENCE]: "CHM",
      [DepartmentName.COMMERCIAL]: "COM",
      [DepartmentName.ART]: "CRS",
    };

    // -------------------------------------------------------------------
    // Admin (also Registrar) + Bursar + Principal + Head Teacher.
    //
    // The Admin/Registrar pairing is one User gaining a second role (PRD
    // FR1.5) — ensureRoleUser is idempotent per-role, so inviting the same
    // email again with Role.STAFF just adds the StaffProfile + REGISTRAR
    // assignment on top of the existing ADMIN role/AdminProfile.
    // -------------------------------------------------------------------
    const adminUser = await ensureRoleUser(prisma, invitations, {
      email: `admin.bimpe@${EMAIL_DOMAIN}`,
      firstName: "Bimpe",
      lastName: "Coker",
      role: Role.ADMIN,
      invitedByUserId: superAdmin.id,
    });
    await ensureRoleUser(prisma, invitations, {
      email: `admin.bimpe@${EMAIL_DOMAIN}`,
      firstName: "Bimpe",
      lastName: "Coker",
      role: Role.STAFF,
      staffCategory: StaffCategory.NON_TEACHING,
      invitedByUserId: superAdmin.id,
    });
    const adminStaffProfile = await prisma.staffProfile.findUniqueOrThrow({
      where: { userId: adminUser.id },
    });
    await ensureStaffAssignment(prisma, staffAssignments, {
      staffId: adminStaffProfile.id,
      assignmentType: AssignmentType.REGISTRAR,
      academicSessionId: session.id,
    });
    logger.log(`Admin/Registrar ready: ${adminUser.email}`);

    const bursarUser = await ensureRoleUser(prisma, invitations, {
      email: `bursar.ifeoma@${EMAIL_DOMAIN}`,
      firstName: "Ifeoma",
      lastName: "Nnamdi",
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

    const principalUser = await ensureRoleUser(prisma, invitations, {
      email: `principal.olusegun@${EMAIL_DOMAIN}`,
      firstName: "Olusegun",
      lastName: "Adeyanju",
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

    const headTeacherUser = await ensureRoleUser(prisma, invitations, {
      email: `headteacher.rita@${EMAIL_DOMAIN}`,
      firstName: "Rita",
      lastName: "Effiong",
      role: Role.STAFF,
      staffCategory: StaffCategory.NON_TEACHING,
      invitedByUserId: superAdmin.id,
    });
    const headTeacherStaffProfile = await prisma.staffProfile.findUniqueOrThrow({
      where: { userId: headTeacherUser.id },
    });
    await ensureStaffAssignment(prisma, staffAssignments, {
      staffId: headTeacherStaffProfile.id,
      assignmentType: AssignmentType.HEADTEACHER,
      academicSessionId: session.id,
    });
    logger.log("Bursar, Principal, Head Teacher ready.");

    // -------------------------------------------------------------------
    // Parents + students — 5 per class arm across Basic 1 – SSS 3 (45
    // total), one parent per student (unlike the full demo, no siblings
    // sharing a household here — kept simple since it isn't the point of
    // this dataset). `key` is local seed-script bookkeeping only, never
    // sent to the API or stored in the DB.
    // -------------------------------------------------------------------
    type StudentDef = {
      key: string;
      firstName: string;
      lastName: string;
      gender: Gender;
      className: string;
      parentFirstName: string;
      parentLastName: string;
      department?: DepartmentName;
    };
    const studentDefs: StudentDef[] = [
      // Basic 1
      { key: "tobiloba-adewale", firstName: "Tobiloba", lastName: "Adewale", gender: Gender.MALE, className: "Basic 1", parentFirstName: "Funmilayo", parentLastName: "Adewale" },
      { key: "chiamaka-eze", firstName: "Chiamaka", lastName: "Eze", gender: Gender.FEMALE, className: "Basic 1", parentFirstName: "Michael", parentLastName: "Okafor" },
      { key: "ikenna-obi", firstName: "Ikenna", lastName: "Obi", gender: Gender.MALE, className: "Basic 1", parentFirstName: "Aisha", parentLastName: "Balogun" },
      { key: "fatima-bello", firstName: "Fatima", lastName: "Bello", gender: Gender.FEMALE, className: "Basic 1", parentFirstName: "Chiamaka", parentLastName: "Ibrahim" },
      { key: "emmanuel-okafor", firstName: "Emmanuel", lastName: "Okafor", gender: Gender.MALE, className: "Basic 1", parentFirstName: "Olumide", parentLastName: "Nwosu" },
      // Basic 2
      { key: "blessing-nwosu", firstName: "Blessing", lastName: "Nwosu", gender: Gender.FEMALE, className: "Basic 2", parentFirstName: "Amina", parentLastName: "Adebisi" },
      { key: "ayodele-fashola", firstName: "Ayodele", lastName: "Fashola", gender: Gender.MALE, className: "Basic 2", parentFirstName: "Grace", parentLastName: "Chukwu" },
      { key: "ruth-danjuma", firstName: "Ruth", lastName: "Danjuma", gender: Gender.FEMALE, className: "Basic 2", parentFirstName: "Chuka", parentLastName: "Danladi" },
      { key: "chukwuemeka-ibe", firstName: "Chukwuemeka", lastName: "Ibe", gender: Gender.MALE, className: "Basic 2", parentFirstName: "Wale", parentLastName: "Oyelaran" },
      { key: "aisha-garba", firstName: "Aisha", lastName: "Garba", gender: Gender.FEMALE, className: "Basic 2", parentFirstName: "Musa", parentLastName: "Effiong" },
      // Basic 3
      { key: "oluwaseun-bakare", firstName: "Oluwaseun", lastName: "Bakare", gender: Gender.MALE, className: "Basic 3", parentFirstName: "Folake", parentLastName: "Igwe" },
      { key: "ngozi-chukwu", firstName: "Ngozi", lastName: "Chukwu", gender: Gender.FEMALE, className: "Basic 3", parentFirstName: "Tunji", parentLastName: "Mustapha" },
      { key: "abdullahi-musa", firstName: "Abdullahi", lastName: "Musa", gender: Gender.MALE, className: "Basic 3", parentFirstName: "Kunle", parentLastName: "Adewale" },
      { key: "temitope-ajayi", firstName: "Temitope", lastName: "Ajayi", gender: Gender.FEMALE, className: "Basic 3", parentFirstName: "Ijeoma", parentLastName: "Okafor" },
      { key: "chinedu-okonkwo", firstName: "Chinedu", lastName: "Okonkwo", gender: Gender.MALE, className: "Basic 3", parentFirstName: "Ngozi", parentLastName: "Balogun" },
      // JSS 1
      { key: "david-adeyemi", firstName: "David", lastName: "Adeyemi", gender: Gender.MALE, className: "JSS 1", parentFirstName: "Bashir", parentLastName: "Ibrahim" },
      { key: "zainab-lawal", firstName: "Zainab", lastName: "Lawal", gender: Gender.FEMALE, className: "JSS 1", parentFirstName: "Comfort", parentLastName: "Nwosu" },
      { key: "emeka-nwankwo", firstName: "Emeka", lastName: "Nwankwo", gender: Gender.MALE, className: "JSS 1", parentFirstName: "Emeka", parentLastName: "Adebisi" },
      { key: "halima-sani", firstName: "Halima", lastName: "Sani", gender: Gender.FEMALE, className: "JSS 1", parentFirstName: "Ronke", parentLastName: "Chukwu" },
      { key: "tunde-afolabi", firstName: "Tunde", lastName: "Afolabi", gender: Gender.MALE, className: "JSS 1", parentFirstName: "Segun", parentLastName: "Danladi" },
      // JSS 2
      { key: "kemi-yusuf", firstName: "Kemi", lastName: "Yusuf", gender: Gender.FEMALE, className: "JSS 2", parentFirstName: "Uju", parentLastName: "Oyelaran" },
      { key: "ifeanyi-obi", firstName: "Ifeanyi", lastName: "Obi", gender: Gender.MALE, className: "JSS 2", parentFirstName: "Femi", parentLastName: "Effiong" },
      { key: "amina-suleiman", firstName: "Amina", lastName: "Suleiman", gender: Gender.FEMALE, className: "JSS 2", parentFirstName: "Halima", parentLastName: "Igwe" },
      { key: "seun-adeyemi", firstName: "Seun", lastName: "Adeyemi", gender: Gender.MALE, className: "JSS 2", parentFirstName: "Bayo", parentLastName: "Mustapha" },
      { key: "grace-chukwu", firstName: "Grace", lastName: "Chukwu", gender: Gender.FEMALE, className: "JSS 2", parentFirstName: "Nkechi", parentLastName: "Adewale" },
      // JSS 3
      { key: "tobi-balogun", firstName: "Tobi", lastName: "Balogun", gender: Gender.MALE, className: "JSS 3", parentFirstName: "Sunday", parentLastName: "Okafor" },
      { key: "chidinma-eze", firstName: "Chidinma", lastName: "Eze", gender: Gender.FEMALE, className: "JSS 3", parentFirstName: "Adaobi", parentLastName: "Balogun" },
      { key: "yakubu-ibrahim", firstName: "Yakubu", lastName: "Ibrahim", gender: Gender.MALE, className: "JSS 3", parentFirstName: "Rasheed", parentLastName: "Ibrahim" },
      { key: "folake-alabi", firstName: "Folake", lastName: "Alabi", gender: Gender.FEMALE, className: "JSS 3", parentFirstName: "Patience", parentLastName: "Nwosu" },
      { key: "chinonso-nnaji", firstName: "Chinonso", lastName: "Nnaji", gender: Gender.MALE, className: "JSS 3", parentFirstName: "Godwin", parentLastName: "Adebisi" },
      // SSS 1 — departments: 2 Science, 2 Commercial, 1 Art
      { key: "damilola-alabi", firstName: "Damilola", lastName: "Alabi", gender: Gender.FEMALE, className: "SSS 1", parentFirstName: "Blessing", parentLastName: "Chukwu", department: DepartmentName.SCIENCE },
      { key: "ngozi-obi", firstName: "Ngozi", lastName: "Obi", gender: Gender.FEMALE, className: "SSS 1", parentFirstName: "Kabiru", parentLastName: "Danladi", department: DepartmentName.COMMERCIAL },
      { key: "yetunde-bakare", firstName: "Yetunde", lastName: "Bakare", gender: Gender.FEMALE, className: "SSS 1", parentFirstName: "Chinyere", parentLastName: "Oyelaran", department: DepartmentName.ART },
      { key: "chinedu-eze", firstName: "Chinedu", lastName: "Eze", gender: Gender.MALE, className: "SSS 1", parentFirstName: "Adebayo", parentLastName: "Effiong", department: DepartmentName.SCIENCE },
      { key: "wale-adeyemi", firstName: "Wale", lastName: "Adeyemi", gender: Gender.MALE, className: "SSS 1", parentFirstName: "Fausat", parentLastName: "Igwe", department: DepartmentName.COMMERCIAL },
      // SSS 2 — departments: 1 Science, 2 Art, 2 Commercial
      { key: "ronke-balogun", firstName: "Ronke", lastName: "Balogun", gender: Gender.FEMALE, className: "SSS 2", parentFirstName: "Obinna", parentLastName: "Mustapha", department: DepartmentName.SCIENCE },
      { key: "feyisayo-adebayo", firstName: "Feyisayo", lastName: "Adebayo", gender: Gender.FEMALE, className: "SSS 2", parentFirstName: "Rekiya", parentLastName: "Adewale", department: DepartmentName.ART },
      { key: "musa-sani", firstName: "Musa", lastName: "Sani", gender: Gender.MALE, className: "SSS 2", parentFirstName: "Damilare", parentLastName: "Okafor", department: DepartmentName.COMMERCIAL },
      { key: "chukwuemeka-okoro", firstName: "Chukwuemeka", lastName: "Okoro", gender: Gender.MALE, className: "SSS 2", parentFirstName: "Ekaete", parentLastName: "Balogun", department: DepartmentName.ART },
      { key: "bimbo-ogundele", firstName: "Bimbo", lastName: "Ogundele", gender: Gender.FEMALE, className: "SSS 2", parentFirstName: "Suleiman", parentLastName: "Ibrahim", department: DepartmentName.COMMERCIAL },
      // SSS 3 — departments: 1 Commercial, 2 Science, 2 Art
      { key: "tayo-yusuf", firstName: "Tayo", lastName: "Yusuf", gender: Gender.MALE, className: "SSS 3", parentFirstName: "Titilayo", parentLastName: "Nwosu", department: DepartmentName.COMMERCIAL },
      { key: "chukwuemeka-nwosu", firstName: "Chukwuemeka", lastName: "Nwosu", gender: Gender.MALE, className: "SSS 3", parentFirstName: "Anthony", parentLastName: "Adebisi", department: DepartmentName.SCIENCE },
      { key: "adaeze-uche", firstName: "Adaeze", lastName: "Uche", gender: Gender.FEMALE, className: "SSS 3", parentFirstName: "Hauwa", parentLastName: "Chukwu", department: DepartmentName.SCIENCE },
      { key: "peter-okafor", firstName: "Peter", lastName: "Okafor", gender: Gender.MALE, className: "SSS 3", parentFirstName: "Ikechukwu", parentLastName: "Danladi", department: DepartmentName.ART },
      { key: "blessing-etim", firstName: "Blessing", lastName: "Etim", gender: Gender.FEMALE, className: "SSS 3", parentFirstName: "Modupe", parentLastName: "Oyelaran", department: DepartmentName.ART },
    ];

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

    const studentIdByKey: Record<string, string> = {};
    let enrollmentCount = 0;
    for (const def of studentDefs) {
      const armInfo = req(arms[def.className], `class arm for ${def.className}`);
      const classArmId = armInfo.id;

      const parentProfile = await ensureParent(def.parentFirstName, def.parentLastName);

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
              existingParentProfileId: parentProfile.id,
              relationship: GuardianRelationship.GUARDIAN,
              isPrimaryContact: true,
            },
          ],
        });
      } else {
        await prisma.user.update({ where: { id: studentProfile.userId }, data: { gender: def.gender } });
      }
      studentIdByKey[def.key] = studentProfile.id;

      // Elective opt-in: Primary → Quantitative Reasoning, JSS → NVE, SSS →
      // this student's one departmental subject. English/Mathematics are
      // COMPULSORY and auto-enroll on class assignment (StudentService.create).
      if (armInfo.category === ClassLevelCategory.PRIMARY) {
        await subjectEnrollments.enroll({
          studentId: studentProfile.id,
          subjectId: req(subjectIdByCode.QR, "subject id for QR"),
          classArmId,
          academicSessionId: session.id,
          termId: firstTerm.id,
        });
        enrollmentCount++;
      } else if (armInfo.category === ClassLevelCategory.JSS) {
        await subjectEnrollments.enroll({
          studentId: studentProfile.id,
          subjectId: subjectIdByCode.NVE,
          classArmId,
          academicSessionId: session.id,
          termId: firstTerm.id,
        });
        enrollmentCount++;
      } else {
        const department = req(def.department, `department for ${def.firstName} ${def.lastName}`);
        const existingDept = await prisma.studentDepartment.findUnique({
          where: { studentId_academicSessionId: { studentId: studentProfile.id, academicSessionId: session.id } },
        });
        if (!existingDept) {
          await studentDepartments.create({
            studentId: studentProfile.id,
            departmentId: req(departmentIds[department], `department id for ${department}`),
            academicSessionId: session.id,
          });
        }
        await subjectEnrollments.enroll({
          studentId: studentProfile.id,
          subjectId: req(subjectIdByCode[req(DEPARTMENT_SUBJECT_CODE[department], `subject code for ${department}`)], `subject id for ${department}`),
          classArmId,
          academicSessionId: session.id,
          termId: firstTerm.id,
        });
        enrollmentCount++;
      }
    }
    logger.log(`${studentDefs.length} students ready (5 per class, Basic 1 – SSS 3), ${enrollmentCount} elective enrollments.`);

    // -------------------------------------------------------------------
    // Fee structures + invoices — 1st Term only. Tuition is one row per
    // category (Primary/JSS/SSS, spanning that category's three class
    // levels via classLevelIds); School Uniform and Xmas Party are
    // school-wide (classLevelIds omitted). School Uniform is the only
    // isMandatory: false row — a student opts in via
    // FeeStructureStudentAssignmentService (Bursar-recorded) rather than
    // it landing on every invoice.
    // -------------------------------------------------------------------
    const feeStructureDefs: { name: string; amount: number; classLevelIds?: string[]; isMandatory: boolean }[] = [
      {
        name: "Tuition",
        amount: 50000,
        classLevelIds: ["Basic 1", "Basic 2", "Basic 3"].map((n) => req(arms[n], `class arm for ${n}`).classLevelId),
        isMandatory: true,
      },
      {
        name: "Tuition",
        amount: 60000,
        classLevelIds: ["JSS 1", "JSS 2", "JSS 3"].map((n) => req(arms[n], `class arm for ${n}`).classLevelId),
        isMandatory: true,
      },
      {
        name: "Tuition",
        amount: 70000,
        classLevelIds: ["SSS 1", "SSS 2", "SSS 3"].map((n) => req(arms[n], `class arm for ${n}`).classLevelId),
        isMandatory: true,
      },
      { name: "School Uniform", amount: 25000, isMandatory: false },
      { name: "Xmas Party", amount: 10000, isMandatory: true },
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
    update: { type: data.type, departmentId: data.departmentId },
    create: data,
  });
}

/**
 * Creates (or reuses) a User with the given role via the real
 * invite-then-accept path (InvitationService.createInTx + accept), setting
 * the shared demo password instead of sending a real email. Calling this
 * twice for the same email with different roles (e.g. ADMIN then STAFF) is
 * how a user gains a second role (PRD FR1.5) — ensureProfileShell/accept are
 * both idempotent per-role.
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
