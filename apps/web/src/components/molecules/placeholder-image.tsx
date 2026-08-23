import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * Stands in for a real campus photo (lab, hall, classroom, etc.) — brand-
 * colored gradient + icon + caption, no external image fetched. Swap for a
 * real `<Image src="/images/..." />` once photography is available; the
 * `label` prop is what to name that file.
 */
export function PlaceholderImage({
  icon: Icon,
  label,
  className,
  aspect = "aspect-[4/3]",
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  aspect?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-2.5 overflow-hidden rounded-card border border-border",
        "bg-[linear-gradient(135deg,rgb(var(--primary)/0.92),rgb(var(--primary)/0.72))] text-primary-foreground",
        aspect,
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgb(var(--primary-foreground)/0.4)]">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <span className="px-3 text-center text-[12px] font-medium tracking-wide text-[rgb(var(--primary-foreground)/0.9)]">
        {label}
      </span>
    </div>
  );
}
