"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import {
  CLASS_LEVEL_CATEGORIES,
  groupToCategories,
  type AssessmentProgressClass,
  type AssessmentProgressResponse,
  type ClassLevelCategory,
  type ClassLevelCategoryGroup,
  type ProgressCount,
} from "@school/types";
import { apiFetch } from "../../lib/api";
import type { CurrentUser } from "../../lib/use-current-user";
import { useCurrentTerm } from "../../lib/use-current-term";
import { CATEGORY_LABEL, SECTION_LABEL, componentCount, isComplete } from "../../lib/assessment-progress";
import { Card, CardHeader } from "../molecules/card";
import { EmptyState } from "../molecules/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../molecules/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../molecules/tabs";
import { Checkbox } from "../atoms/checkbox";
import { Label } from "../atoms/label";
import { StatCard } from "../atoms/stat-card";
import { AssessmentProgressByClass } from "./assessment-progress-by-class";
import { AssessmentProgressBySubject } from "./assessment-progress-by-subject";
import { AssessmentProgressByTeacher } from "./assessment-progress-by-teacher";

/**
 * GET /dashboard/assessment-progress — completion counts only (never a
 * student list), regrouped client-side by class, by subject, or by teacher
 * from the one response. The section/category filters go to the server
 * (which also enforces a Principal/VP/Headteacher's own section); the class
 * filter just narrows the already-loaded response.
 */

interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
}
interface SessionOption {
  id: string;
  name: string;
}

const ALL = "__all__";

export function AssessmentProgressView({ user }: { user: CurrentUser }) {
  const isSchoolWide =
    user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN") || user.assignmentTypes.includes("REGISTRAR");
  // Mirrors the API's resolvePrincipalHeadteacherCategories — only used to
  // shape the filter options; the server enforces the real scope.
  const ownCategories = useMemo<ClassLevelCategory[]>(() => {
    if (isSchoolWide) return CLASS_LEVEL_CATEGORIES;
    const set = new Set<ClassLevelCategory>();
    if (user.assignmentTypes.includes("PRINCIPAL") || user.assignmentTypes.includes("VICE_PRINCIPAL")) {
      groupToCategories("JSS_SSS").forEach((c) => set.add(c));
    }
    if (user.assignmentTypes.includes("HEADTEACHER")) {
      groupToCategories("CRECHE_NURSERY_PRIMARY").forEach((c) => set.add(c));
    }
    return CLASS_LEVEL_CATEGORIES.filter((c) => set.has(c));
  }, [isSchoolWide, user.assignmentTypes]);
  const ownSections = (Object.keys(SECTION_LABEL) as ClassLevelCategoryGroup[]).filter((g) =>
    groupToCategories(g).some((c) => ownCategories.includes(c)),
  );

  const { termId: currentTermId } = useCurrentTerm();
  const [termId, setTermId] = useState("");
  const [section, setSection] = useState<string>(ALL);
  const [category, setCategory] = useState<string>(ALL);
  const [classArmId, setClassArmId] = useState<string>(ALL);
  const [view, setView] = useState("class");
  const [incompleteOnly, setIncompleteOnly] = useState(false);

  useEffect(() => {
    if (!termId && currentTermId) setTermId(currentTermId);
  }, [termId, currentTermId]);

  const { data: sessions } = useQuery({
    queryKey: ["academic-sessions"],
    queryFn: () => apiFetch<SessionOption[]>("/academic-sessions", { auth: true }),
    staleTime: 5 * 60_000,
  });
  const { data: terms } = useQuery({
    queryKey: ["terms", "all"],
    queryFn: () => apiFetch<TermOption[]>("/terms", { auth: true }),
    staleTime: 5 * 60_000,
  });
  const sessionName = (id: string) => sessions?.find((s) => s.id === id)?.name;

  const categoryOptions = ownCategories.filter(
    (c) => section === ALL || groupToCategories(section as ClassLevelCategoryGroup).includes(c),
  );

  // A narrower section/category invalidates a category/class picked under the previous one.
  useEffect(() => {
    setCategory(ALL);
  }, [section]);
  useEffect(() => {
    setClassArmId(ALL);
  }, [section, category, termId]);

  const params = new URLSearchParams({ termId });
  if (section !== ALL) params.set("section", section);
  if (category !== ALL) params.set("classLevelCategory", category);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", "assessment-progress", termId, section, category],
    queryFn: () => apiFetch<AssessmentProgressResponse>(`/dashboard/assessment-progress?${params.toString()}`, { auth: true }),
    enabled: Boolean(termId),
  });

  const classes = useMemo(
    () => (data?.classes ?? []).filter((c) => classArmId === ALL || c.classArmId === classArmId),
    [data, classArmId],
  );

  const totals = useMemo(() => {
    let scoreDone = 0;
    let scoreTotal = 0;
    const sum = (pick: (c: AssessmentProgressClass) => ProgressCount | null): ProgressCount =>
      classes.reduce(
        (acc, c) => {
          const v = pick(c);
          return v ? { completed: acc.completed + v.completed, total: acc.total + v.total } : acc;
        },
        { completed: 0, total: 0 },
      );
    for (const cls of classes) {
      for (const s of cls.subjects) {
        for (const c of s.components) {
          scoreTotal += 1;
          if (isComplete(componentCount(c, s.total))) scoreDone += 1;
        }
      }
    }
    return {
      scoreSheets: { completed: scoreDone, total: scoreTotal },
      classTeacher: sum((c) => c.classTeacherComments),
      skills: sum((c) => c.skills),
      principal: sum((c) => c.principalComments),
    };
  }, [classes]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Filters" sub="Counts only — how much of each assessment and comment has been recorded for active students" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="ap-term">Term</Label>
            <Select value={termId} onValueChange={setTermId}>
              <SelectTrigger id="ap-term" className="mt-1">
                <SelectValue placeholder="Select term" />
              </SelectTrigger>
              <SelectContent>
                {(terms ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {sessionName(t.academicSessionId) ? `${sessionName(t.academicSessionId)} · ${t.name}` : t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {ownSections.length > 1 && (
            <div>
              <Label htmlFor="ap-section">Section</Label>
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger id="ap-section" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All sections</SelectItem>
                  {ownSections.map((g) => (
                    <SelectItem key={g} value={g}>
                      {SECTION_LABEL[g]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="ap-category">Class category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="ap-category" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ap-class">Class</Label>
            <Select value={classArmId} onValueChange={setClassArmId}>
              <SelectTrigger id="ap-class" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All classes</SelectItem>
                {(data?.classes ?? []).map((c) => (
                  <SelectItem key={c.classArmId} value={c.classArmId}>
                    {c.className}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Checkbox id="ap-incomplete" checked={incompleteOnly} onCheckedChange={(v) => setIncompleteOnly(v === true)} />
          <Label htmlFor="ap-incomplete" className="cursor-pointer">
            Show incomplete only
          </Label>
        </div>
      </Card>

      {error ? (
        <Card>
          <p className="text-sm text-danger">{error instanceof Error ? error.message : "Couldn't load assessment progress."}</p>
        </Card>
      ) : isLoading || !termId ? (
        <Card>
          <p className="text-sm text-muted">Loading…</p>
        </Card>
      ) : classes.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardCheck} title="No classes" description="No classes match these filters for this term." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Score sheets complete"
              value={`${totals.scoreSheets.completed}/${totals.scoreSheets.total}`}
              sub="Class · subject · component"
            />
            <StatCard
              label="Class-teacher comments"
              value={`${totals.classTeacher.completed}/${totals.classTeacher.total}`}
            />
            <StatCard label="Skills" value={`${totals.skills.completed}/${totals.skills.total}`} />
            <StatCard label="Principal comments" value={`${totals.principal.completed}/${totals.principal.total}`} />
          </div>

          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="class">By class</TabsTrigger>
              <TabsTrigger value="subject">By subject</TabsTrigger>
              <TabsTrigger value="teacher">By teacher</TabsTrigger>
            </TabsList>
            <TabsContent value="class">
              <AssessmentProgressByClass classes={classes} incompleteOnly={incompleteOnly} />
            </TabsContent>
            <TabsContent value="subject">
              <AssessmentProgressBySubject classes={classes} incompleteOnly={incompleteOnly} />
            </TabsContent>
            <TabsContent value="teacher">
              <AssessmentProgressByTeacher classes={classes} incompleteOnly={incompleteOnly} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
