import { ClassLevelCategory } from "@prisma/client";
import type { RequestUser } from "../auth/jwt.strategy";

/**
 * PRD §5 footnotes 5-7 / BUILD_PLAN.md §9: the class-level-category split a
 * Principal (JSS/SSS — secondary) or Headteacher (Creche/Reception/Nursery/
 * Primary) assignment restricts them to — same mapping already used by
 * ScheduleGenerationRequestService.assertCanTrigger, TimetableSlotService's
 * whole-school overview, AttendanceAnalyticsService, and DashboardService,
 * consolidated here as the one place list/write endpoints outside those
 * check it too. Super-Admin, Admin, and Registrar are exempt (school-wide),
 * same as AttendanceAnalyticsService.resolveScopeForUser's own convention —
 * an Admin who also happens to hold a Principal/Headteacher title stays
 * unscoped, matching how "Admin" is already treated everywhere else in this
 * file's near-Admin-parity CASL grant. Read straight off the JWT-derived
 * RequestUser, no DB round trip, same "trust the JWT claim" precedent those
 * call sites already establish.
 *
 * Vice Principal shares the Principal's JSS/SSS scope by product decision —
 * VP assists the Principal specifically, not the Headteacher's section — but
 * does NOT get the Principal/Headteacher's AI-scheduling trigger/manual-edit
 * capability. That's why Vice Principal is folded into the JSS/SSS branch
 * here (this function backs read/write *visibility* scoping only: report
 * comments, staff/student rosters, attendance, duty-roster reads) but is
 * deliberately absent from the separate, hand-checked PRINCIPAL/HEADTEACHER
 * actor lists in ScheduleGenerationRequestService.assertCanTrigger and the
 * exam-schedule/duty-assignment/invigilation-assignment controllers'
 * assertCanManage — those gate the AI-scheduling domain and must stay as-is.
 *
 * Returns `null` when this rule doesn't restrict the caller — either because
 * they're school-wide (Super-Admin/Admin/Registrar) or because they hold
 * none of these titles (a plain STAFF member is scoped elsewhere, by
 * class-arm assignment). A user holding more than one title at once
 * (unusual, not schema-prevented) gets the union, which can be every
 * category — i.e. effectively unscoped, which is correct.
 */
export function resolvePrincipalHeadteacherCategories(user: RequestUser): ClassLevelCategory[] | null {
  if (user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") || user.assignmentTypes.includes("REGISTRAR")) {
    return null;
  }

  const isPrincipal = user.assignmentTypes.includes("PRINCIPAL");
  const isVicePrincipal = user.assignmentTypes.includes("VICE_PRINCIPAL");
  const isHeadteacher = user.assignmentTypes.includes("HEADTEACHER");
  if (!isPrincipal && !isVicePrincipal && !isHeadteacher) return null;

  const categories = new Set<ClassLevelCategory>();
  if (isPrincipal || isVicePrincipal) {
    categories.add(ClassLevelCategory.JSS);
    categories.add(ClassLevelCategory.SSS);
  }
  if (isHeadteacher) {
    categories.add(ClassLevelCategory.CRECHE);
    categories.add(ClassLevelCategory.RECEPTION);
    categories.add(ClassLevelCategory.NURSERY);
    categories.add(ClassLevelCategory.PRIMARY);
  }
  return [...categories];
}
