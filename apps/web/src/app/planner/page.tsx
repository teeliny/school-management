"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ClassLevelCategory } from "@school/types";
import { useCurrentUser } from "../../lib/use-current-user";
import { apiFetch } from "../../lib/api";
import { AppShell } from "../../components/templates/app-shell";
import { Letterhead } from "../../components/molecules/letterhead";
import { Card, CardHeader } from "../../components/molecules/card";
import { CollapsibleCard } from "../../components/molecules/collapsible-card";
import { Label } from "../../components/atoms/label";
import { Button } from "../../components/atoms/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/molecules/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/molecules/tabs";
import { TimetableGrid } from "../../components/organisms/timetable-grid";
import { AllClassesTimetableView } from "../../components/organisms/all-classes-timetable-view";
import { TimetableSlotForm } from "../../components/organisms/timetable-slot-form";
import { ExamTimetableGrid } from "../../components/organisms/exam-timetable-grid";
import { AllClassesExamTimetableView } from "../../components/organisms/all-classes-exam-timetable-view";
import { InvigilationGrid } from "../../components/organisms/invigilation-grid";
import { DutyGrid } from "../../components/organisms/duty-grid";
import { TriggerGenerationForm } from "../../components/organisms/trigger-generation-form";
import { GenerationRequestsList, type GenerationRequestsListHandle } from "../../components/organisms/generation-requests-list";
import { SchedulingApprovalsQueue } from "../../components/organisms/scheduling-approvals-queue";
import { SchedulingConstraintManager } from "../../components/organisms/scheduling-constraint-manager";
import {
  MyClassTimetableSection,
  MySubjectTimetableSection,
  MyWardTimetableSection,
  MyClassExamSection,
  MySubjectExamSection,
  MyWardExamSection,
  MyInvigilationSection,
  MyWeeklyDutySection,
  type MyWard,
} from "../../components/organisms/my-planner-sections";

type TabKey = "class-timetable" | "exam-timetable" | "invigilation" | "weekly-duty" | "generate-approve" | "constraints";
type ClassLevelCategoryGroupValue = "JSS_SSS" | "CRECHE_NURSERY_PRIMARY";

const TAB_KEYS: TabKey[] = ["class-timetable", "exam-timetable", "invigilation", "weekly-duty", "generate-approve", "constraints"];
const TAB_LABEL: Record<TabKey, string> = {
  "class-timetable": "Class Timetable",
  "exam-timetable": "Exam Timetable",
  invigilation: "Invigilation",
  "weekly-duty": "Weekly Duty",
  "generate-approve": "Generate & Approve",
  constraints: "Constraints",
};

interface ClassArmOption {
  id: string;
  name: string;
  displayName: string;
  classLevel: { category: string };
}
interface AcademicSessionOption {
  id: string;
  name: string;
  isCurrent: boolean;
}
interface TermOption {
  id: string;
  name: string;
  academicSessionId: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}
interface AssessmentComponentOption {
  id: string;
  name: string;
  type: "CA" | "MID_TERM" | "EXAM";
  classLevelCategory: string;
  termId: string;
}
interface StaffAssignmentItem {
  assignmentType: string;
  isActive: boolean;
  classArmId: string | null;
  subjectId: string | null;
  classArm: { name: string; classLevel: { name: string; category: ClassLevelCategory } } | null;
  subject: { id: string; name: string } | null;
}

// PRD §3.8/§5 footnote 5: same JSS/SSS vs. Creche/Nursery/Primary split
// used server-side (categoryToGroup, @school/types) — reimplemented inline
// against the plain-string classLevelCategory these option shapes carry.
function groupOf(classLevelCategory: string): ClassLevelCategoryGroupValue {
  return classLevelCategory === "JSS" || classLevelCategory === "SSS" ? "JSS_SSS" : "CRECHE_NURSERY_PRIMARY";
}

export default function PlannerPage() {
  return (
    <Suspense fallback={null}>
      <PlannerPageInner />
    </Suspense>
  );
}

function PlannerPageInner() {
  const { user, loading, logout } = useCurrentUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestsListRef = useRef<GenerationRequestsListHandle>(null);
  const approvalsQueueRef = useRef<{ refresh: () => void }>(null);

  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "class-timetable";
  const [tab, setTab] = useState<TabKey>(TAB_KEYS.includes(initialTab) ? initialTab : "class-timetable");

  const [classArms, setClassArms] = useState<ClassArmOption[]>([]);
  const [sessions, setSessions] = useState<AcademicSessionOption[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [components, setComponents] = useState<AssessmentComponentOption[]>([]);
  const [myAssignments, setMyAssignments] = useState<StaffAssignmentItem[]>([]);
  const [wards, setWards] = useState<MyWard[]>([]);
  const [selectedWardId, setSelectedWardId] = useState<string | null>(null);

  // Class Timetable tab state
  const [ctViewMode, setCtViewMode] = useState<"single" | "all">("single");
  const [ctClassArmId, setCtClassArmId] = useState(searchParams.get("classArmId") ?? "");
  const [ctAcademicSessionId, setCtAcademicSessionId] = useState("");
  const [ctTermId, setCtTermId] = useState("");
  const [ctRefreshKey, setCtRefreshKey] = useState(0);

  // Exam Timetable tab state
  const [etViewMode, setEtViewMode] = useState<"single" | "all">("single");
  const [etTermId, setEtTermId] = useState("");
  const [etComponentId, setEtComponentId] = useState(searchParams.get("assessmentComponentId") ?? "");
  const [etClassArmId, setEtClassArmId] = useState("");

  // Invigilation tab state
  const [ivTermId, setIvTermId] = useState("");
  const [ivComponentId, setIvComponentId] = useState(searchParams.get("assessmentComponentId") ?? "");

  // Weekly Duty tab state
  const [dutyGroup, setDutyGroup] = useState<ClassLevelCategoryGroupValue | "">(
    (searchParams.get("classLevelCategoryGroup") as ClassLevelCategoryGroupValue | null) ?? "",
  );
  const [dutyTermId, setDutyTermId] = useState("");

  useEffect(() => {
    apiFetch<ClassArmOption[]>("/class-arms", { auth: true }).then(setClassArms).catch(() => setClassArms([]));
    apiFetch<AcademicSessionOption[]>("/academic-sessions", { auth: true }).then(setSessions).catch(() => setSessions([]));
    apiFetch<TermOption[]>("/terms", { auth: true }).then(setTerms).catch(() => setTerms([]));
    apiFetch<AssessmentComponentOption[]>("/assessment-components", { auth: true })
      .then((all) => setComponents(all.filter((c) => c.type === "MID_TERM" || c.type === "EXAM")))
      .catch(() => setComponents([]));
    apiFetch<StaffAssignmentItem[]>("/staff-assignments/mine", { auth: true }).then(setMyAssignments).catch(() => setMyAssignments([]));
    apiFetch<MyWard[]>("/students/wards", { auth: true }).then(setWards).catch(() => setWards([]));
  }, []);

  // Default to whichever ward is still active, same precedent used
  // elsewhere (report-card-filters.tsx, dashboard/page.tsx).
  useEffect(() => {
    if (selectedWardId || wards.length === 0) return;
    setSelectedWardId((wards.find((w) => w.status === "ACTIVE") ?? wards[0])!.id);
  }, [wards, selectedWardId]);

  // Default Class Timetable's session/term to whichever is `isCurrent` once
  // nothing else has already set one — same "current unless picked"
  // precedent as ReportCardFilters/useCurrentTerm. This is what actually
  // makes a bare `?classArmId=` deep link (the approvals queue, a student
  // profile's quick links) show data instead of an empty grid, since
  // TimetableGrid needs all three of classArmId/academicSessionId/termId.
  useEffect(() => {
    if (ctAcademicSessionId || sessions.length === 0) return;
    setCtAcademicSessionId(sessions.find((s) => s.isCurrent)?.id ?? sessions[0]!.id);
  }, [sessions, ctAcademicSessionId]);

  useEffect(() => {
    if (ctTermId || !ctAcademicSessionId) return;
    const forSession = terms.filter((t) => t.academicSessionId === ctAcademicSessionId);
    if (forSession.length === 0) return;
    setCtTermId(forSession.find((t) => t.isCurrent)?.id ?? forSession[0]!.id);
  }, [terms, ctAcademicSessionId, ctTermId]);

  // Same default for Exam Timetable's term — skipped when an
  // assessmentComponentId arrived via URL, since that case is owned by the
  // effect below instead (a deep-linked component may be from a past term,
  // not necessarily the current one).
  useEffect(() => {
    if (etTermId || terms.length === 0 || etComponentId) return;
    setEtTermId(terms.find((t) => t.isCurrent)?.id ?? terms[0]!.id);
  }, [terms, etTermId, etComponentId]);

  // The approvals queue's "View & edit" links point back at this same route
  // with a different `?tab=`/`classArmId`/`assessmentComponentId`/
  // `classLevelCategoryGroup` — since the user is already on /planner,
  // Next's <Link> updates the URL without remounting this component, so the
  // useState(searchParams.get(...)) initializers above only ever fire once,
  // at first mount. This effect re-syncs from the live `searchParams` object
  // (which next/navigation re-emits reactively) every time it changes, so a
  // click while already here actually switches tabs and pre-fills the
  // target, not just the address bar.
  useEffect(() => {
    const urlTab = searchParams.get("tab") as TabKey | null;
    if (!urlTab || !TAB_KEYS.includes(urlTab)) return;
    setTab(urlTab);
    if (urlTab === "class-timetable") {
      const armId = searchParams.get("classArmId");
      if (armId) {
        setCtClassArmId(armId);
        setCtViewMode("single");
      }
    } else if (urlTab === "exam-timetable") {
      const componentId = searchParams.get("assessmentComponentId");
      if (componentId) setEtComponentId(componentId);
      // A classArmId (student profile quick links) always means "show this
      // one class" — takes priority over the approvals queue's componentId-
      // only "all classes for this batch" deep link, which is the only other
      // source of this query param.
      const armId = searchParams.get("classArmId");
      if (armId) {
        setEtClassArmId(armId);
        setEtViewMode("single");
      } else if (componentId) {
        setEtViewMode("all");
      }
    } else if (urlTab === "invigilation") {
      const componentId = searchParams.get("assessmentComponentId");
      if (componentId) setIvComponentId(componentId);
    } else if (urlTab === "weekly-duty") {
      const group = searchParams.get("classLevelCategoryGroup") as ClassLevelCategoryGroupValue | null;
      if (group) setDutyGroup(group);
    }
  }, [searchParams]);

  // The exam-timetable deep link only carries assessmentComponentId (an
  // EXAM_TIMETABLE batch can span multiple class arms, so there's no single
  // classArmId to pre-fill) — Term isn't in the URL at all, so once the
  // component is known (from the effect above or a manual pick) and the
  // components list has loaded, back-fill the Term select from the
  // component's own termId rather than leaving it blank.
  useEffect(() => {
    if (!etComponentId || etTermId) return;
    const match = components.find((c) => c.id === etComponentId);
    if (match) setEtTermId(match.termId);
  }, [components, etComponentId, etTermId]);
  useEffect(() => {
    if (!ivComponentId || ivTermId) return;
    const match = components.find((c) => c.id === ivComponentId);
    if (match) setIvTermId(match.termId);
  }, [components, ivComponentId, ivTermId]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }
  if (!user) return null;

  const isAdmin = user.roles.includes("SUPER_ADMIN") || user.roles.includes("ADMIN");
  const isSuperAdmin = user.roles.includes("SUPER_ADMIN");
  // Matches every row controller's assertCanManage actor set (Super-Admin/
  // Admin role, or an active Registrar/Principal/Headteacher assignment) —
  // generate, edit, and drag-and-drop are all this same grant; only final
  // approval (assertCanApproveBatch, ScheduleGenerationRequestController)
  // narrows further to Super-Admin alone.
  const canManage =
    isAdmin ||
    user.assignmentTypes.includes("REGISTRAR") ||
    ["PRINCIPAL", "HEADTEACHER"].some((t) => user.assignmentTypes.includes(t));

  const myClassTeacherAssignments = myAssignments.filter(
    (a) => a.assignmentType === "CLASS_TEACHER" && a.isActive && a.classArmId && a.classArm,
  );
  const mySubjectTeacherAssignments = myAssignments.filter(
    (a) => a.assignmentType === "SUBJECT_TEACHER" && a.isActive && a.classArmId && a.subjectId && a.classArm && a.subject,
  );

  // PRD FR6.7: invigilation rosters are visible to assigned staff/Registrar/
  // Super-Admin/Admin, never to students or parents — same treatment applied
  // here to the weekly duty roster (also a staff-only rotation, nothing a
  // parent/student has a stake in). A user who is STAFF via any assignment
  // (including one who's *also* a Parent on a separate profile) still sees
  // these; a pure Parent/Student account does not.
  const canSeeStaffRosters = isAdmin || user.roles.includes("STAFF");

  // A Principal/Headteacher who isn't also unscoped (Super-Admin/Registrar)
  // only ever sees their own class-level group's assessment components —
  // mirrors ScheduleGenerationRequestService.assertCanTrigger's scoping, now
  // reflected in what they're offered to pick, not just enforced after the
  // fact on submit.
  const isUnscoped = isSuperAdmin || user.assignmentTypes.includes("REGISTRAR");
  const scopedGroup: ClassLevelCategoryGroupValue | null = isUnscoped
    ? null
    : user.assignmentTypes.includes("PRINCIPAL")
      ? "JSS_SSS"
      : user.assignmentTypes.includes("HEADTEACHER")
        ? "CRECHE_NURSERY_PRIMARY"
        : null;

  function changeTab(next: TabKey) {
    setTab(next);
    router.replace(`/planner?tab=${next}`);
  }

  // Scoped to a term first (every term has its own same-named "Mid-Term
  // Test"/"Exam" component — without this, the picker shows several
  // identically-labeled entries with no way to tell them apart), then
  // grouped Secondary/Primary the same way as before, then narrowed to the
  // viewer's own group if they're a scoped Principal/Headteacher.
  function GroupedComponentOptions({ termId }: { termId: string }) {
    const forTerm = termId ? components.filter((c) => c.termId === termId) : components;
    const secondary = forTerm.filter((c) => groupOf(c.classLevelCategory) === "JSS_SSS" && (!scopedGroup || scopedGroup === "JSS_SSS"));
    const primary = forTerm.filter(
      (c) => groupOf(c.classLevelCategory) === "CRECHE_NURSERY_PRIMARY" && (!scopedGroup || scopedGroup === "CRECHE_NURSERY_PRIMARY"),
    );
    return (
      <>
        {secondary.length > 0 && (
          <SelectGroup>
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted">Secondary (JSS / SSS)</div>
            {secondary.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.classLevelCategory} · {c.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {primary.length > 0 && (
          <SelectGroup>
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted">Primary (Creche / Nursery / Primary)</div>
            {primary.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.classLevelCategory} · {c.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </>
    );
  }

  const termsForCtSession = terms.filter((t) => !ctAcademicSessionId || t.academicSessionId === ctAcademicSessionId);
  const selectedDutyTerm = terms.find((t) => t.id === dutyTermId);
  const etSelectedComponent = components.find((c) => c.id === etComponentId);
  // Only class arms that actually belong to the selected component's
  // classLevelCategory can ever have exam rows for it — e.g. a JSS Mid-Term
  // component's rows are only ever for JSS class arms, never SSS/Primary.
  const etClassArmOptions = etSelectedComponent
    ? classArms.filter((arm) => arm.classLevel.category === etSelectedComponent.classLevelCategory)
    : classArms;

  return (
    <AppShell user={user} onLogout={logout}>
      <Letterhead eyebrow="Academics · Planner" title="Planner" />

      <Tabs value={tab} onValueChange={(v) => changeTab(v as TabKey)}>
        <TabsList>
          {TAB_KEYS.filter(
            (key) =>
              (key !== "constraints" || isAdmin) &&
              (key !== "generate-approve" || canManage) &&
              (!["invigilation", "weekly-duty"].includes(key) || canSeeStaffRosters),
          ).map((key) => (
            <TabsTrigger key={key} value={key}>
              {TAB_LABEL[key]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="class-timetable">
          <CollapsibleCard title="Select academic session and term" className="mb-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="ct-session">Academic session</Label>
                <Select value={ctAcademicSessionId} onValueChange={setCtAcademicSessionId}>
                  <SelectTrigger id="ct-session" className="mt-1">
                    <SelectValue placeholder="Select session" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ct-term">Term</Label>
                <Select value={ctTermId} onValueChange={setCtTermId}>
                  <SelectTrigger id="ct-term" className="mt-1">
                    <SelectValue placeholder="Select term" />
                  </SelectTrigger>
                  <SelectContent>
                    {termsForCtSession.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CollapsibleCard>

          {(myClassTeacherAssignments.length > 0 || mySubjectTeacherAssignments.length > 0 || wards.length > 0) && (
            <div className="mb-4 space-y-4">
              <MyClassTimetableSection
                assignments={myClassTeacherAssignments}
                academicSessionId={ctAcademicSessionId}
                termId={ctTermId}
              />
              {user.staffProfileId && (
                <MySubjectTimetableSection
                  assignments={mySubjectTeacherAssignments}
                  staffId={user.staffProfileId}
                  academicSessionId={ctAcademicSessionId}
                  termId={ctTermId}
                />
              )}
              <MyWardTimetableSection
                wards={wards}
                selectedWardId={selectedWardId}
                onSelectWard={setSelectedWardId}
                academicSessionId={ctAcademicSessionId}
                termId={ctTermId}
              />
            </div>
          )}

          {canManage && (
            <>
              {ctViewMode === "single" && (
                <CollapsibleCard title="Select class arm" className="mb-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="ct-class-arm">Class arm</Label>
                      <Select value={ctClassArmId} onValueChange={setCtClassArmId}>
                        <SelectTrigger id="ct-class-arm" className="mt-1">
                          <SelectValue placeholder="Select class" />
                        </SelectTrigger>
                        <SelectContent>
                          {classArms.map((arm) => (
                            <SelectItem key={arm.id} value={arm.id}>
                              {arm.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CollapsibleCard>
              )}

              <div className="mb-3 flex gap-1.5">
                <Button type="button" size="sm" variant={ctViewMode === "all" ? "primary" : "outline"} onClick={() => setCtViewMode("all")}>
                  All classes
                </Button>
                <Button type="button" size="sm" variant={ctViewMode === "single" ? "primary" : "outline"} onClick={() => setCtViewMode("single")}>
                  Single class
                </Button>
              </div>

              {ctViewMode === "all" ? (
                <CollapsibleCard title="Whole-school timetable">
                  <AllClassesTimetableView
                    academicSessionId={ctAcademicSessionId}
                    termId={ctTermId}
                    onViewClass={(id) => {
                      setCtClassArmId(id);
                      setCtViewMode("single");
                    }}
                    lockedGroup={scopedGroup ?? undefined}
                  />
                </CollapsibleCard>
              ) : (
                <div className="space-y-4">
                  <CollapsibleCard title="Weekly timetable">
                    <TimetableGrid
                      classArmId={ctClassArmId}
                      academicSessionId={ctAcademicSessionId}
                      termId={ctTermId}
                      canManage={canManage}
                      refreshKey={ctRefreshKey}
                    />
                  </CollapsibleCard>
                  <CollapsibleCard title="Add a slot" defaultOpen={false}>
                    <TimetableSlotForm
                      classArmId={ctClassArmId}
                      academicSessionId={ctAcademicSessionId}
                      termId={ctTermId}
                      onCreated={() => setCtRefreshKey((k) => k + 1)}
                    />
                  </CollapsibleCard>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="exam-timetable">
          {(myClassTeacherAssignments.length > 0 || mySubjectTeacherAssignments.length > 0 || wards.length > 0) && (
            <div className="mb-4 space-y-4">
              <MyClassExamSection assignments={myClassTeacherAssignments} />
              {user.staffProfileId && <MySubjectExamSection assignments={mySubjectTeacherAssignments} />}
              <MyWardExamSection wards={wards} selectedWardId={selectedWardId} onSelectWard={setSelectedWardId} />
            </div>
          )}

          {canManage && (
            <>
              <CollapsibleCard title="Select term, assessment component, and class arm" className="mb-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="et-term">Term</Label>
                    <Select
                      value={etTermId}
                      onValueChange={(v) => {
                        setEtTermId(v);
                        // Same-named components repeat once per term — a
                        // component picked under the old term filter is no
                        // longer meaningful once the filter itself changes.
                        setEtComponentId("");
                      }}
                    >
                      <SelectTrigger id="et-term" className="mt-1">
                        <SelectValue placeholder="Select term" />
                      </SelectTrigger>
                      <SelectContent>
                        {terms.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="et-component">Assessment component</Label>
                    <Select
                      value={etComponentId}
                      onValueChange={(v) => {
                        setEtComponentId(v);
                        // A class arm from a different classLevelCategory than
                        // the newly-picked component can never have exam rows
                        // for it.
                        setEtClassArmId("");
                      }}
                    >
                      <SelectTrigger id="et-component" className="mt-1">
                        <SelectValue placeholder={etTermId ? "Select a component for this term" : "Select a term first"} />
                      </SelectTrigger>
                      <SelectContent>
                        <GroupedComponentOptions termId={etTermId} />
                      </SelectContent>
                    </Select>
                  </div>
                  {etViewMode === "single" && (
                    <div>
                      <Label htmlFor="et-class-arm">Class arm</Label>
                      <Select value={etClassArmId} onValueChange={setEtClassArmId}>
                        <SelectTrigger id="et-class-arm" className="mt-1">
                          <SelectValue placeholder={etComponentId ? "Select class" : "Select a component first"} />
                        </SelectTrigger>
                        <SelectContent>
                          {etClassArmOptions.map((arm) => (
                            <SelectItem key={arm.id} value={arm.id}>
                              {arm.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </CollapsibleCard>

              <div className="mb-3 flex gap-1.5">
                <Button type="button" size="sm" variant={etViewMode === "all" ? "primary" : "outline"} onClick={() => setEtViewMode("all")}>
                  All classes
                </Button>
                <Button type="button" size="sm" variant={etViewMode === "single" ? "primary" : "outline"} onClick={() => setEtViewMode("single")}>
                  Single class
                </Button>
              </div>

              <CollapsibleCard title="Exam timetable">
                {etViewMode === "all" ? (
                  <AllClassesExamTimetableView
                    assessmentComponentId={etComponentId}
                    onViewClass={(id) => {
                      setEtClassArmId(id);
                      setEtViewMode("single");
                    }}
                  />
                ) : (
                  <ExamTimetableGrid classArmId={etClassArmId} assessmentComponentId={etComponentId} canManage={canManage} />
                )}
              </CollapsibleCard>
            </>
          )}
        </TabsContent>

        {canSeeStaffRosters && (
          <TabsContent value="invigilation">
            {user.staffProfileId && (
              <div className="mb-4">
                <MyInvigilationSection staffId={user.staffProfileId} />
              </div>
            )}

            <CollapsibleCard title="Select term and assessment component" className="mb-4">
              <div className="grid max-w-lg grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="iv-term">Term</Label>
                  <Select
                    value={ivTermId}
                    onValueChange={(v) => {
                      setIvTermId(v);
                      setIvComponentId("");
                    }}
                  >
                    <SelectTrigger id="iv-term" className="mt-1">
                      <SelectValue placeholder="Select term" />
                    </SelectTrigger>
                    <SelectContent>
                      {terms.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="iv-component">Assessment component</Label>
                  <Select value={ivComponentId} onValueChange={setIvComponentId}>
                    <SelectTrigger id="iv-component" className="mt-1">
                      <SelectValue placeholder={ivTermId ? "Select a component for this term" : "Select a term first"} />
                    </SelectTrigger>
                    <SelectContent>
                      <GroupedComponentOptions termId={ivTermId} />
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title="Invigilation roster">
              <InvigilationGrid assessmentComponentId={ivComponentId} canManage={canManage} />
            </CollapsibleCard>
          </TabsContent>
        )}

        {canSeeStaffRosters && (
          <TabsContent value="weekly-duty">
            {user.staffProfileId && (
              <div className="mb-4">
                <MyWeeklyDutySection staffId={user.staffProfileId} />
              </div>
            )}

            <CollapsibleCard title="Select group and term" className="mb-4">
              <div className="grid max-w-lg grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="duty-group">Class level group</Label>
                  <Select value={dutyGroup} onValueChange={(v) => setDutyGroup(v as ClassLevelCategoryGroupValue)}>
                    <SelectTrigger id="duty-group" className="mt-1">
                      <SelectValue placeholder="Select a group" />
                    </SelectTrigger>
                    <SelectContent>
                      {(!scopedGroup || scopedGroup === "JSS_SSS") && <SelectItem value="JSS_SSS">JSS / SSS</SelectItem>}
                      {(!scopedGroup || scopedGroup === "CRECHE_NURSERY_PRIMARY") && (
                        <SelectItem value="CRECHE_NURSERY_PRIMARY">Creche / Nursery / Primary</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="duty-term">Term</Label>
                  <Select value={dutyTermId} onValueChange={setDutyTermId}>
                    <SelectTrigger id="duty-term" className="mt-1">
                      <SelectValue placeholder="Select term" />
                    </SelectTrigger>
                    <SelectContent>
                      {terms.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CollapsibleCard>

            <CollapsibleCard title="Weekly duty roster">
              <DutyGrid
                classLevelCategoryGroup={dutyGroup as ClassLevelCategoryGroupValue}
                weekStartDateFrom={selectedDutyTerm?.startDate ?? ""}
                weekStartDateTo={selectedDutyTerm?.endDate ?? ""}
                canManage={canManage}
              />
            </CollapsibleCard>
          </TabsContent>
        )}

        {canManage && (
          <TabsContent value="generate-approve">
            <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-[1fr_1.3fr]">
              <Card>
                <CardHeader title="Start a new generation run" sub="Runs asynchronously — check status below" />
                <TriggerGenerationForm onTriggered={() => requestsListRef.current?.refresh()} />
              </Card>
              <Card>
                <CardHeader title="Recent generation requests" />
                <GenerationRequestsList ref={requestsListRef} />
              </Card>
            </div>

            <Card className="mt-4">
              <CardHeader
                title="Pending review"
                sub={
                  isSuperAdmin
                    ? "AI-generated rosters awaiting approval — approve or reject the whole roster in one action"
                    : "AI-generated rosters awaiting Super-Admin approval — view only"
                }
              />
              <SchedulingApprovalsQueue ref={approvalsQueueRef} canAct={isSuperAdmin} />
            </Card>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="constraints">
            <Card>
              <CardHeader
                title="Scheduling constraints"
                sub="Tunes the AI generator's rules (PRD §3.8) — seeded with defaults at setup, editable here without a code change"
              />
              <SchedulingConstraintManager />
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </AppShell>
  );
}
