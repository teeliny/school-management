import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface StatCardTrend {
  direction: "up" | "down";
  label: string;
  tone?: "positive" | "negative";
}

const toneClass = {
  default: "",
  danger: "bg-danger-bg",
  warning: "bg-warning-bg",
} as const;

/**
 * PRD FR9.2's "single trending/headline numbers -> stat cards" vocabulary —
 * used across every role's dashboard for the school-wide/class-wide counts
 * (Super-Admin's total students/staff/parents row, Bursar's outstanding
 * balance, etc.). `tone` carries alert coloring for exception-style stats
 * (e.g. a gateway-reconciliation count > 0); `onClick` backs the "links to
 * list on click" behavior Super-Admin's payment reconciliation queue needs.
 */
export function StatCard({
  label,
  value,
  sub,
  trend,
  tone = "default",
  onClick,
  className,
}: {
  label: string;
  value: string | number;
  sub?: ReactNode;
  trend?: StatCardTrend;
  tone?: "default" | "danger" | "warning";
  onClick?: () => void;
  className?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "rounded-card border border-border px-4 py-3.5 text-left",
        toneClass[tone],
        onClick && "cursor-pointer transition hover:border-primary/40",
        className,
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-[26px] font-semibold leading-none">{value}</span>
        {trend && (
          <span
            className={cn(
              "font-mono text-[11px] font-medium",
              trend.tone === "negative" ? "text-danger" : "text-success",
            )}
          >
            {trend.direction === "up" ? "▲" : "▼"} {trend.label}
          </span>
        )}
      </div>
      {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
    </Comp>
  );
}
