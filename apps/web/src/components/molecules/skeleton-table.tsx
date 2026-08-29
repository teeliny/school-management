import { Skeleton } from "../atoms/skeleton";

/**
 * Loading placeholder for a `<table>`-shaped section (InvoiceList,
 * PaymentLedger, PendingApprovalsQueue, etc.) — a header bar plus `rows`
 * bars of decreasing-width cells, so it reads as tabular data rather than
 * a generic block. `columns` controls how many cell-widths per row.
 */
export function SkeletonTable({ rows = 4, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4 border-b border-border pb-2">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-border/60 py-1.5">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={c === 0 ? "h-4 w-28" : "h-4 w-14"} />
          ))}
        </div>
      ))}
    </div>
  );
}
