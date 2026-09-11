"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, User as UserIcon } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

interface StaffListItem {
  id: string;
  employeeId: string | null;
  staffCategory: "TEACHING" | "NON_TEACHING" | null;
  department: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
  user: { firstName: string; lastName: string; avatarUrl: string | null; email: string; phone: string | null };
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  TERMINATED: "danger",
};

const CATEGORY_LABEL: Record<string, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-teaching",
};

/**
 * Staff-profile counterpart to PeopleList — GET /staff-profiles already
 * applies PRD's Principal/Headteacher section scoping server-side
 * (StaffProfileService.findAll), so this component just renders whatever
 * comes back.
 */
export function StaffList({
  refreshKey,
  canEdit = false,
  onEdit,
}: {
  refreshKey?: unknown;
  canEdit?: boolean;
  onEdit?: (id: string) => void;
}) {
  const [staff, setStaff] = useState<StaffListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [nameSort, setNameSort] = useState<"asc" | "desc">("asc");

  const load = useCallback(() => {
    apiFetch<StaffListItem[]>("/staff-profiles", { auth: true })
      .then(setStaff)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load staff"));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filteredStaff = useMemo(() => {
    if (!staff) return staff;
    const term = search.trim().toLowerCase();
    const filtered = staff.filter((member) => {
      const matchesTerm =
        !term ||
        `${member.user.firstName} ${member.user.lastName}`.toLowerCase().includes(term) ||
        (member.employeeId ?? "").toLowerCase().includes(term) ||
        member.user.email.toLowerCase().includes(term);
      const matchesStatus = !statusFilter || member.status === statusFilter;
      return matchesTerm && matchesStatus;
    });
    return [...filtered].sort((a, b) => {
      const cmp = `${a.user.firstName} ${a.user.lastName}`.localeCompare(`${b.user.firstName} ${b.user.lastName}`);
      return nameSort === "asc" ? cmp : -cmp;
    });
  }, [staff, search, statusFilter, nameSort]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!staff) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          placeholder="Search by name, employee ID, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search staff"
          className="sm:flex-1"
        />
        <Select value={statusFilter || "ALL"} onValueChange={(v) => setStatusFilter(v === "ALL" ? "" : v)}>
          <SelectTrigger className="sm:w-44" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="ON_LEAVE">On leave</SelectItem>
            <SelectItem value="TERMINATED">Terminated</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {staff.length === 0 ? (
        <p className="text-sm text-muted">No staff visible to you yet.</p>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">S/N</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">
                  <button
                    type="button"
                    onClick={() => setNameSort((d) => (d === "asc" ? "desc" : "asc"))}
                    className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
                  >
                    Name
                    {nameSort === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Email</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Employee ID</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Phone</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Category</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Department</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Status</th>
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide" />
              </tr>
            </thead>
            <tbody>
              {filteredStaff?.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-3 text-muted">
                    No staff match the current filters.
                  </td>
                </tr>
              )}
              {filteredStaff?.map((member, index) => (
                <tr key={member.id} className="border-b border-border/60 last:border-none even:bg-card-inset">
                  <td className="py-2.5 pr-4 text-muted">{index + 1}</td>
                  <td className="py-2.5 pr-4 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {member.user.avatarUrl ? (
                        <img
                          src={member.user.avatarUrl}
                          alt=""
                          className="h-3.5 w-3.5 flex-none rounded-full border border-border object-cover"
                        />
                      ) : (
                        <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border border-border bg-card-inset text-muted">
                          <UserIcon className="h-2.5 w-2.5" />
                        </span>
                      )}
                      {member.user.firstName} {member.user.lastName}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-muted">{member.user.email}</td>
                  <td className="py-2.5 pr-4 font-mono text-muted">{member.employeeId ?? "—"}</td>
                  <td className="py-2.5 pr-4 font-mono text-muted">{member.user.phone ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-muted">{member.staffCategory ? CATEGORY_LABEL[member.staffCategory] : "—"}</td>
                  <td className="py-2.5 pr-4 text-muted">{member.department ?? "—"}</td>
                  <td className="py-2.5 pr-4">
                    <Badge variant={STATUS_VARIANT[member.status] ?? "muted"}>{member.status}</Badge>
                  </td>
                  <td className="py-2.5 text-right">
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={() => onEdit?.(member.id)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
