"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatPersonName } from "@school/types";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";

export interface ParentWard {
  id: string;
  relationship: string;
  isPrimaryContact: boolean;
  student: {
    id: string;
    admissionNumber: string;
    status: string;
    user: { firstName: string; lastName: string; middleName: string | null };
    currentClass: { id: string; name: string; classLevel: { name: string; order: number } } | null;
  };
}

export interface ParentListItem {
  id: string;
  occupation: string | null;
  address: string | null;
  emailBounced: boolean;
  emailChangedByStaffAt: string | null;
  user: { firstName: string; lastName: string; middleName: string | null; email: string; phone: string | null; status: string };
  wards: ParentWard[];
}

export function wardClassLabel(ward: ParentWard) {
  const cls = ward.student.currentClass;
  return cls ? `${cls.classLevel.name} ${cls.name}` : "No class";
}

/**
 * Admin-facing parent directory — GET /parent-profiles already includes
 * each parent's wards (with current class), so search/filter by ward name
 * or class happens client-side, same as StaffList.
 */
export function ParentList({
  refreshKey,
  selectedId,
  onEdit,
}: {
  refreshKey?: unknown;
  selectedId?: string | null;
  // Omitted for a view-only (Registrar/Bursar) caller — hides the Edit column.
  onEdit?: (id: string) => void;
}) {
  const [parents, setParents] = useState<ParentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [nameSort, setNameSort] = useState<"asc" | "desc">("asc");

  const load = useCallback(() => {
    apiFetch<ParentListItem[]>("/parent-profiles", { auth: true })
      .then(setParents)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load parents"));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const classOptions = useMemo(() => {
    const byId = new Map<string, { label: string; order: number }>();
    for (const parent of parents ?? []) {
      for (const ward of parent.wards) {
        const cls = ward.student.currentClass;
        if (cls) byId.set(cls.id, { label: wardClassLabel(ward), order: cls.classLevel.order });
      }
    }
    return [...byId.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [parents]);

  const filteredParents = useMemo(() => {
    if (!parents) return parents;
    const term = search.trim().toLowerCase();
    const filtered = parents.filter((parent) => {
      const matchesTerm =
        !term ||
        formatPersonName(parent.user).toLowerCase().includes(term) ||
        parent.user.email.toLowerCase().includes(term) ||
        (parent.user.phone ?? "").toLowerCase().includes(term) ||
        parent.wards.some(
          (w) =>
            formatPersonName(w.student.user).toLowerCase().includes(term) ||
            w.student.admissionNumber.toLowerCase().includes(term),
        );
      const matchesClass = !classFilter || parent.wards.some((w) => w.student.currentClass?.id === classFilter);
      return matchesTerm && matchesClass;
    });
    return [...filtered].sort((a, b) => {
      const cmp = formatPersonName(a.user).localeCompare(formatPersonName(b.user));
      return nameSort === "asc" ? cmp : -cmp;
    });
  }, [parents, search, classFilter, nameSort]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!parents) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          placeholder="Search by parent, email, phone, or student…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search parents"
          className="sm:flex-1"
        />
        <Select value={classFilter || "ALL"} onValueChange={(v) => setClassFilter(v === "ALL" ? "" : v)}>
          <SelectTrigger className="sm:w-44" aria-label="Filter by ward's class">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All classes</SelectItem>
            {classOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-[12px] text-muted">
        {filteredParents?.length ?? 0} of {parents.length} parents
      </p>
      {parents.length === 0 ? (
        <p className="text-sm text-muted">No parents yet.</p>
      ) : (
        <div className="max-h-[560px] overflow-auto">
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
                    Parent
                    {nameSort === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Contact</th>
                <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Students</th>
                <th className="py-2 text-[10px] font-medium uppercase tracking-wide" />
              </tr>
            </thead>
            <tbody>
              {filteredParents?.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-muted">
                    No parents match the current filters.
                  </td>
                </tr>
              )}
              {filteredParents?.map((parent, index) => (
                <tr
                  key={parent.id}
                  className={
                    parent.id === selectedId
                      ? "border-b border-border/60 bg-primary/10 last:border-none"
                      : "border-b border-border/60 last:border-none even:bg-card-inset"
                  }
                >
                  <td className="py-2.5 pr-4 align-top text-muted">{index + 1}</td>
                  <td className="py-2.5 pr-4 align-top">
                    <div className="font-medium">{formatPersonName(parent.user)}</div>
                    {parent.occupation && <div className="text-[11.5px] text-muted">{parent.occupation}</div>}
                    {parent.emailBounced && (
                      <Badge variant="danger" className="mt-1">
                        Email bounced
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 align-top font-mono text-muted">
                    <div>{parent.user.email}</div>
                    <div>{parent.user.phone ?? "—"}</div>
                  </td>
                  <td className="py-2.5 pr-4 align-top">
                    {parent.wards.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <ul className="space-y-1">
                        {parent.wards.map((ward) => (
                          <li key={ward.id} className="flex flex-wrap items-center gap-1.5">
                            <Link href={`/students/${ward.student.id}`} className="hover:underline">
                              {formatPersonName(ward.student.user)}
                            </Link>
                            <Badge variant="muted">{wardClassLabel(ward)}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="py-2.5 text-right align-top">
                    {onEdit && (
                      <Button variant="outline" size="sm" onClick={() => onEdit(parent.id)}>
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
