"use client";

import { useQuery } from "@tanstack/react-query";
import { formatPersonName } from "@school/types";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { Card, CardHeader } from "../molecules/card";
import { Badge } from "../atoms/badge";

interface MostAbsentStaffRow {
  staffId: string;
  employeeId: string | null;
  firstName: string | null;
  lastName: string | null;
  present: number;
  absent: number;
  late: number;
  excused: number;
}
interface MostAbsentStaffResponse {
  termId: string;
  mostAbsentStaff: MostAbsentStaffRow[];
}

const LIMIT = 5;

/**
 * Net-new dashboard widget (not one of PRD §6.9's documented FR9.x stats) —
 * visibility matches `read AttendanceSession` (Super-Admin/Admin/Registrar/
 * Principal/Headteacher/Vice-Principal), the same set that can already
 * drill into any one staff member's term attendance via the "staff term
 * summary" route. Mounted once on the dashboard page rather than duplicated
 * into each role's own "-additions" organism, since it's the same widget
 * for all of them.
 */
export function MostAbsentStaffCard({ user }: { user: CurrentUser }) {
  const { termId } = useCurrentTerm();
  const canView =
    user.roles.includes("SUPER_ADMIN") ||
    user.roles.includes("ADMIN") ||
    ["REGISTRAR", "PRINCIPAL", "HEADTEACHER", "VICE_PRINCIPAL"].some((t) => user.assignmentTypes.includes(t));

  const { data } = useQuery({
    queryKey: ["dashboard", "most-absent-staff", termId],
    queryFn: () => apiFetch<MostAbsentStaffResponse>(`/dashboard/most-absent-staff?termId=${termId}&limit=${LIMIT}`, { auth: true }),
    enabled: Boolean(termId) && canView,
  });

  if (!canView) return null;

  const rows = data?.mostAbsentStaff ?? null;

  return (
    <Card>
      <CardHeader title="Most absent staff" sub={`Top ${LIMIT} by absence count, this term`} />
      {rows === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No staff absences recorded this term.</p>
      ) : (
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">#</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Staff</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Absent</th>
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Late / Excused</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.staffId} className="border-b border-border/60 last:border-none even:bg-card-inset">
                  <td className="py-2 pr-4 text-muted">{index + 1}</td>
                  <td className="py-2 pr-4 font-medium">
                    {formatPersonName({ firstName: row.firstName ?? "", lastName: row.lastName ?? "" })}{" "}
                    {row.employeeId && <span className="font-mono text-muted">({row.employeeId})</span>}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant="danger">{row.absent}</Badge>
                  </td>
                  <td className="py-2 font-mono text-muted">
                    {row.late} / {row.excused}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
