import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * Standard "nothing here yet" treatment for a list/table/section with no
 * rows — replaces a bare `<p className="text-sm text-muted">No X yet.</p>`
 * with an icon + message (+ optional action) so an empty section reads as
 * an intentional state, not a loading flash or a bug. Sized to sit inside
 * a Card/CollapsibleCard/TabsContent, not a full page.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-card-inset text-muted">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-xs text-[12.5px] text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
