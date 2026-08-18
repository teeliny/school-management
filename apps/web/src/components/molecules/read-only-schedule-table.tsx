/**
 * BUILD_PLAN.md §9 Step 6c: the same per-kind column layout
 * `scheduling-approvals-queue.tsx` already draws inline for its expand-view
 * (headers + ordered cell arrays), factored out into one shared
 * presentational component so the column definitions don't drift between
 * the approval queue and the "My schedule" dashboard section. No actions —
 * purely a read-only rows-in table.
 */
export function ReadOnlyScheduleTable({
  headers,
  rows,
  emptyMessage,
}: {
  headers: string[];
  rows: { id: string; cells: string[] }[];
  emptyMessage: string;
}) {
  if (rows.length === 0) return <p className="text-[12px] text-muted">{emptyMessage}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-[10.5px] uppercase tracking-wide text-muted">
            {headers.map((h) => (
              <th key={h} className="py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border">
              {row.cells.map((cell, i) => (
                <td key={i} className="py-1.5 pr-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
