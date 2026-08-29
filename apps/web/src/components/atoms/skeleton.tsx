import { cn } from "../../lib/cn";

/**
 * The one shimmer primitive every loading skeleton in the app is built
 * from — a plain pulsing block, sized/shaped entirely via `className`
 * (e.g. `h-4 w-32` for a text line, `h-40 w-full rounded-card` for a card).
 * Composed skeletons (PageLoadingSkeleton, per-organism table/form/list
 * skeletons) just arrange several of these to match their real content's
 * layout, so nothing shifts when the real content mounts.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-card-inset", className)} />;
}
