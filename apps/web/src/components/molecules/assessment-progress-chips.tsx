import { ClipboardCheck } from "lucide-react";
import type { AssessmentProgressClass, AssessmentProgressComponent, ProgressCount } from "@school/types";
import { cn } from "../../lib/cn";
import { componentCount, isComplete, subjectComplete } from "../../lib/assessment-progress";
import { Badge } from "../atoms/badge";
import { Card } from "./card";
import { EmptyState } from "./empty-state";
import { ProgressBar } from "./progress-bar";

/** "n/total" + a thin bar, toned by completion — the one cell shape every view uses. */
export function CountChip({ label, count, className }: { label: string; count: ProgressCount; className?: string }) {
  const pct = count.total > 0 ? (count.completed / count.total) * 100 : 0;
  const done = isComplete(count);
  return (
    <div className={cn("min-w-[120px] flex-1 rounded-lg border border-border px-2.5 py-2 text-[12px]", className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-muted">{label}</span>
        <span className={cn("font-mono", done ? "text-success" : count.completed === 0 ? "text-danger" : "text-warning")}>
          {count.completed}/{count.total}
        </span>
      </div>
      <ProgressBar value={pct} size="sm" />
    </div>
  );
}

export function StatusBadge({ complete, empty }: { complete: boolean; empty?: boolean }) {
  if (empty) return <Badge variant="muted">Nothing to record</Badge>;
  return complete ? <Badge variant="success">Complete</Badge> : <Badge variant="warning">Incomplete</Badge>;
}

export function ComponentChips({ subject }: { subject: { total: number; components: AssessmentProgressComponent[] } }) {
  if (subject.components.length === 0) {
    return <p className="text-[12px] text-muted">No assessment components open yet this term.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {subject.components.map((c) => (
        <CountChip key={c.componentId} label={c.name} count={componentCount(c, subject.total)} />
      ))}
    </div>
  );
}

export function SubjectRow({
  title,
  sub,
  subject,
}: {
  title: string;
  sub: string;
  subject: { total: number; components: AssessmentProgressComponent[] };
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{title}</div>
          <div className="text-[11.5px] text-muted">{sub}</div>
        </div>
        <StatusBadge complete={subjectComplete(subject)} />
      </div>
      <ComponentChips subject={subject} />
    </div>
  );
}

export function ClassReportChips({ cls, show }: { cls: AssessmentProgressClass; show: ("classTeacher" | "skills" | "principal")[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {show.includes("classTeacher") && <CountChip label="Class-teacher comments" count={cls.classTeacherComments} />}
      {show.includes("skills") &&
        (cls.skills ? (
          <CountChip label="Skills" count={cls.skills} />
        ) : (
          <div className="min-w-[120px] flex-1 rounded-lg border border-border px-2.5 py-2 text-[12px] text-muted">
            Skills — none apply
          </div>
        ))}
      {show.includes("principal") && <CountChip label="Principal comment" count={cls.principalComments} />}
    </div>
  );
}

export function AllCompleteState() {
  return (
    <Card>
      <EmptyState icon={ClipboardCheck} title="Nothing outstanding" description="Everything matching these filters is complete." />
    </Card>
  );
}
