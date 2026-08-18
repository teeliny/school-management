import { cn } from "../../lib/cn";

export type BadgeVariant = "success" | "warning" | "danger" | "info" | "muted";

const variantClass: Record<BadgeVariant, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  muted: "bg-card-inset text-muted",
};

export function Badge({
  variant = "muted",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide",
        "before:h-1.5 before:w-1.5 before:rounded-full before:bg-current",
        variantClass[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
