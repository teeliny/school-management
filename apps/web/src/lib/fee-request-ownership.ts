import type { CurrentUser } from "./use-current-user";

export type FeeRequestViewer = Pick<CurrentUser, "staffProfileId" | "roles">;

/**
 * Client-side mirror of the API's assertIsFeeRequestRaiser
 * (apps/api/src/fees/fee-request-ownership.ts): a pending discount request or
 * cash/manual-transfer payment is editable only by whoever raised it. A null
 * raiser means it was raised by someone with no StaffProfile, which can only
 * be the (singleton) Super-Admin. This only decides whether to show "Edit" —
 * the server enforces it regardless.
 */
export function canEditFeeRequest(raisedByStaffId: string | null, viewer: FeeRequestViewer | null | undefined): boolean {
  if (!viewer) return false;
  if (raisedByStaffId === null) return viewer.roles.includes("SUPER_ADMIN");
  return viewer.staffProfileId !== null && viewer.staffProfileId === raisedByStaffId;
}
