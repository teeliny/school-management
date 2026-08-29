import { Skeleton } from "../atoms/skeleton";

/**
 * Loading placeholder for a bordered-row list (the FeeStructureManager/
 * AcademicSessionManager/ClassArmManager "list one row per item, actions
 * on the right" shape) — `rows` bars, each a name-shaped skeleton on the
 * left and one or two action-button-shaped skeletons on the right.
 */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
          <Skeleton className="h-4 w-40" />
          <div className="flex gap-1.5">
            <Skeleton className="h-7 w-14 rounded-md" />
            <Skeleton className="h-7 w-14 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
