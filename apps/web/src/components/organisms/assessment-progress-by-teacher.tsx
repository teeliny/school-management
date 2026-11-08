"use client";

import { useMemo } from "react";
import type { AssessmentProgressClass } from "@school/types";
import { bucketBy, isComplete, subjectComplete, type TeacherBucket } from "../../lib/assessment-progress";
import { Card, CardHeader } from "../molecules/card";
import { AllCompleteState, ClassReportChips, CountChip, StatusBadge, SubjectRow } from "../molecules/assessment-progress-chips";

export function AssessmentProgressByTeacher({ classes, incompleteOnly }: { classes: AssessmentProgressClass[]; incompleteOnly: boolean }) {
  const subjectTeachers = useMemo(
    () =>
      bucketBy(
        classes.flatMap((cls) => cls.subjects.map((subject) => ({ staff: subject.teachers, item: { cls, subject } }))),
        "No subject teacher assigned",
      ),
    [classes],
  );
  const classTeachers = useMemo(
    () => bucketBy(classes.map((cls) => ({ staff: cls.classTeachers, item: cls })), "No class teacher assigned"),
    [classes],
  );
  const principalOwners = useMemo(
    () => bucketBy(classes.map((cls) => ({ staff: cls.principalCommentOwners, item: cls })), "No Principal/Headteacher assigned"),
    [classes],
  );

  const classTeacherDone = (cls: AssessmentProgressClass) =>
    cls.totalStudents === 0 || (isComplete(cls.classTeacherComments) && (cls.skills === null || isComplete(cls.skills)));
  const principalDone = (cls: AssessmentProgressClass) => cls.totalStudents === 0 || isComplete(cls.principalComments);

  const filter = <T,>(buckets: TeacherBucket<T>[], done: (item: T) => boolean) =>
    buckets
      .map((b) => ({ ...b, items: incompleteOnly ? b.items.filter((i) => !done(i)) : b.items }))
      .filter((b) => b.items.length > 0);

  const visibleSubjectTeachers = filter(subjectTeachers, (i) => subjectComplete(i.subject));
  const visibleClassTeachers = filter(classTeachers, classTeacherDone);
  const visiblePrincipalOwners = filter(principalOwners, principalDone);

  if (visibleSubjectTeachers.length + visibleClassTeachers.length + visiblePrincipalOwners.length === 0) {
    return <AllCompleteState />;
  }

  return (
    <div className="space-y-6">
      {visibleSubjectTeachers.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-[17px] font-semibold">Subject teachers</h2>
          <p className="mb-3 text-[12px] text-muted">CA, mid-term test and exam scores per class and subject.</p>
          <div className="space-y-4">
            {visibleSubjectTeachers.map((bucket) => {
              const total = subjectTeachers.find((b) => b.key === bucket.key)!.items;
              const done = total.filter((i) => subjectComplete(i.subject)).length;
              return (
                <Card key={bucket.key}>
                  <CardHeader
                    title={bucket.name}
                    sub={`${done} of ${total.length} class subject${total.length === 1 ? "" : "s"} complete`}
                    action={<StatusBadge complete={done === total.length} />}
                  />
                  <div className="space-y-2">
                    {bucket.items.map(({ cls, subject }) => (
                      <SubjectRow
                        key={`${cls.classArmId}-${subject.subjectId}`}
                        title={`${cls.className} · ${subject.subjectName}`}
                        sub={`${subject.total} enrolled`}
                        subject={subject}
                      />
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {visibleClassTeachers.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-[17px] font-semibold">Class teachers</h2>
          <p className="mb-3 text-[12px] text-muted">Class-teacher comments and skills ratings.</p>
          <div className="space-y-4">
            {visibleClassTeachers.map((bucket) => (
              <Card key={bucket.key}>
                <CardHeader
                  title={bucket.name}
                  action={<StatusBadge complete={bucket.items.every(classTeacherDone)} />}
                />
                <div className="space-y-2">
                  {bucket.items.map((cls) => (
                    <div key={cls.classArmId} className="rounded-lg border border-border p-3">
                      <div className="mb-2 text-[13px] font-medium">
                        {cls.className} <span className="text-[11.5px] font-normal text-muted">· {cls.totalStudents} students</span>
                      </div>
                      <ClassReportChips cls={cls} show={["classTeacher", "skills"]} />
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {visiblePrincipalOwners.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-[17px] font-semibold">Principal / Headteacher</h2>
          <p className="mb-3 text-[12px] text-muted">Principal comments per class.</p>
          <div className="space-y-4">
            {visiblePrincipalOwners.map((bucket) => (
              <Card key={bucket.key}>
                <CardHeader title={bucket.name} action={<StatusBadge complete={bucket.items.every(principalDone)} />} />
                <div className="flex flex-wrap gap-2">
                  {bucket.items.map((cls) => (
                    <CountChip key={cls.classArmId} label={cls.className} count={cls.principalComments} />
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
