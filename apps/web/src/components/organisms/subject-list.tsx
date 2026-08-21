"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { apiFetch, ApiError } from "../../lib/api";
import { Badge, type BadgeVariant } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Input } from "../atoms/input";
import { cn } from "../../lib/cn";
import type { ClassLevelCategory, SubjectType } from "../../lib/subject-applicability";

interface ChildSubject {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

export interface ClassSubjectSummary {
  id: string;
  classLevelCategory: ClassLevelCategory;
  type: SubjectType;
  departmentId: string | null;
  department?: { name: string } | null;
}

export interface SubjectListItem {
  id: string;
  name: string;
  code: string;
  isGroup: boolean;
  requiresCalculation: boolean;
  childSubjects?: ChildSubject[];
  // Which class group(s) this subject is currently assigned to, and how
  // (ClassSubject isn't session-scoped — see schema.prisma) — read-only here
  // (badges only); adding/removing/changing a class-group assignment happens
  // via "Edit" -> CreateSubjectForm's class-group section.
  classSubjects?: ClassSubjectSummary[];
}

const TYPE_VARIANT: Record<ClassSubjectSummary["type"], BadgeVariant> = {
  COMPULSORY: "info",
  GENERAL: "muted",
  DEPARTMENT: "warning",
};

// PRD §3.3: only top-level subjects are listed here (SubjectService.findAll
// excludes children of a group — they're taught/scored independently but
// only surfaced via their parent's detail view). "Edit" hands the subject up
// to the parent page, which populates the Create-subject form for editing
// (see CreateSubjectForm's editingSubject prop) rather than editing inline —
// that's also where class-group assignments are added/removed/changed now.
export function SubjectList({
  canManage,
  onEdit,
}: {
  canManage?: boolean;
  onEdit?: (subject: SubjectListItem) => void;
}) {
  const {
    data: subjects,
    error: queryError,
  } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => apiFetch<SubjectListItem[]>("/subjects", { auth: true }),
  });
  const error = queryError instanceof ApiError ? queryError.message : queryError ? "Failed to load subjects" : null;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredSubjects = useMemo(() => {
    if (!subjects) return subjects;
    const term = search.trim().toLowerCase();
    if (!term) return subjects;
    return subjects.filter(
      (subject) => subject.name.toLowerCase().includes(term) || subject.code.toLowerCase().includes(term),
    );
  }, [subjects, search]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!subjects) return <p className="text-sm text-muted">Loading…</p>;
  if (subjects.length === 0) return <p className="text-sm text-muted">No subjects defined yet.</p>;

  return (
    <div className="space-y-3">
      <Input
        type="search"
        placeholder="Search by name or code…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search subjects"
      />
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Code</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Name</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Class groups</th>
              <th className="py-2 pr-4 text-[10px] font-medium uppercase tracking-wide">Notes</th>
              {canManage && <th className="py-2 text-[10px] font-medium uppercase tracking-wide">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredSubjects?.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="py-3 text-muted">
                  No subjects match &ldquo;{search}&rdquo;.
                </td>
              </tr>
            )}
            {filteredSubjects?.map((subject) => {
              const hasChildren = subject.isGroup && (subject.childSubjects?.length ?? 0) > 0;
              const isExpanded = hasChildren && expanded.has(subject.id);
              return (
                <Fragment key={subject.id}>
                  <tr className="border-b border-border/60 last:border-none">
                    <td className="py-2.5 pr-4 font-mono text-muted">{subject.code}</td>
                    <td className="py-1.5 pr-4 font-medium">
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(subject.id)}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? "Collapse child subjects" : "Expand child subjects"}
                          className="-ml-1 flex items-center gap-1 py-1 pl-1 pr-2 text-left"
                        >
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 flex-none text-muted transition-transform duration-150",
                              isExpanded && "rotate-90",
                            )}
                          />
                          <span>{subject.name}</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="w-4 flex-none" />
                          <span>{subject.name}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex flex-wrap gap-1.5">
                        {subject.classSubjects?.length ? (
                          subject.classSubjects.map((cs) => (
                            <Badge key={cs.id} variant={TYPE_VARIANT[cs.type]}>
                              {cs.classLevelCategory}
                              {cs.type === "DEPARTMENT" && cs.department ? ` · ${cs.department.name}` : ""}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted">Not assigned</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex flex-wrap gap-1.5">
                        {subject.isGroup && <Badge variant="info">Group</Badge>}
                        {subject.requiresCalculation && <Badge variant="muted">Calculation</Badge>}
                      </div>
                    </td>
                    {canManage && (
                      <td className="py-2.5">
                        <Button type="button" variant="outline" size="sm" onClick={() => onEdit?.(subject)}>
                          Edit
                        </Button>
                      </td>
                    )}
                  </tr>
                  {isExpanded &&
                    subject.childSubjects?.map((child) => (
                      <tr key={child.id} className="border-b border-border/60 last:border-none bg-card-inset/40">
                        <td className="py-2 pr-4 pl-6 font-mono text-muted">{child.code}</td>
                        <td className="py-2 pr-4 pl-10 text-muted">
                          — {child.name}
                          {!child.isActive && (
                            <Badge variant="danger" className="ml-1.5">
                              Disabled
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-4" />
                        <td className="py-2 pr-4" />
                        {canManage && <td className="py-2" />}
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
