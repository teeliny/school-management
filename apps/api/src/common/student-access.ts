import { AssignmentType, ClassLevelCategory } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../auth/jwt.strategy";
import { resolvePrincipalHeadteacherCategories } from "./class-level-category-scope";

export interface StudentAccessSubject {
  userId: string | null;
  currentClassId: string | null;
  currentClass: { classLevel: { category: ClassLevelCategory } } | null;
  guardians: { parentId: string }[];
}

/**
 * Single choke point for "can this user view this specific student" — shared
 * by StudentService.findOneForUser (the student profile page) and
 * StudentSubjectEnrollmentService (the subjects section on that same page),
 * so the two endpoints can't drift on who's allowed to see a given student.
 * Mirrors scopeWhereForUser's role priority (STAFF before PARENT/STUDENT)
 * since a user can hold more than one role.
 */
export async function canAccessStudent(
  prisma: PrismaService,
  student: StudentAccessSubject,
  user: RequestUser,
): Promise<boolean> {
  if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN")) return true;

  if (user.roles.includes("STAFF")) {
    if (await hasActiveSchoolWideAssignment(prisma, user.id)) return true;

    const categories = resolvePrincipalHeadteacherCategories(user);
    if (categories) {
      return student.currentClass !== null && categories.includes(student.currentClass.classLevel.category);
    }

    if (student.currentClassId) {
      const classArmIds = await activeAssignedClassArmIds(prisma, user.id);
      if (classArmIds.includes(student.currentClassId)) return true;
    }
  }

  if (user.roles.includes("PARENT")) {
    const parentProfile = await prisma.parentProfile.findUnique({ where: { userId: user.id } });
    if (parentProfile && student.guardians.some((g) => g.parentId === parentProfile.id)) return true;
  }

  if (user.roles.includes("STUDENT") && student.userId === user.id) return true;

  return false;
}

export async function activeAssignedClassArmIds(prisma: PrismaService, userId: string): Promise<string[]> {
  const staffProfile = await prisma.staffProfile.findUnique({ where: { userId } });
  if (!staffProfile) return [];

  const assignments = await prisma.staffAssignment.findMany({
    where: {
      staffId: staffProfile.id,
      isActive: true,
      assignmentType: { in: [AssignmentType.CLASS_TEACHER, AssignmentType.SUBJECT_TEACHER] },
      classArmId: { not: null },
    },
  });

  return [...new Set(assignments.map((a) => a.classArmId).filter((id): id is string => id !== null))];
}

// PRINCIPAL/HEADTEACHER are deliberately excluded here — they're scoped to
// their own section instead (resolvePrincipalHeadteacherCategories, called
// separately by both callers before falling back to this).
export async function hasActiveSchoolWideAssignment(prisma: PrismaService, userId: string): Promise<boolean> {
  const staffProfile = await prisma.staffProfile.findUnique({ where: { userId } });
  if (!staffProfile) return false;

  const count = await prisma.staffAssignment.count({
    where: {
      staffId: staffProfile.id,
      isActive: true,
      // BURSAR needs to find any student to attach an invoice/payment/fee
      // opt-in to (FeeStructureStudentAssignmentService), and REGISTRAR
      // enrolls/maintains any student — neither is tied to a classArmId.
      assignmentType: { in: [AssignmentType.REGISTRAR, AssignmentType.BURSAR] },
    },
  });
  return count > 0;
}
