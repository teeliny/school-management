import { cn } from "../../lib/cn";

type Tone = "success" | "warning" | "danger";

const fillClass: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};
const strokeVar: Record<Tone, string> = {
  success: "rgb(var(--success))",
  warning: "rgb(var(--warning))",
  danger: "rgb(var(--danger))",
};

// PRD FR9.2: "% completion is exactly what a progress bar communicates" —
// thresholds are deliberately generous (most completion stats here are
// "how much of a required task is done", where even 50% partway through an
// open window isn't yet an alarm) rather than tuned per-widget; a caller
// wanting different thresholds passes a pre-computed value, not a raw ratio.
function toneForValue(value: number): Tone {
  if (value >= 80) return "success";
  if (value >= 50) return "warning";
  return "danger";
}

export function ProgressBar({
  value,
  label,
  size = "md",
  className,
}: {
  value: number;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const tone = toneForValue(clamped);

  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px]">
          <span className="text-muted">{label}</span>
          <span className="font-mono text-foreground">{clamped}%</span>
        </div>
      )}
      <div className={cn("w-full overflow-hidden rounded-full bg-card-inset", size === "sm" ? "h-1.5" : "h-2.5")}>
        <div className={cn("h-full rounded-full transition-[width]", fillClass[tone])} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

/** Circular variant of ProgressBar, same value contract — used for "% this term" self-check stats (attendance) per FR9.8/FR9.9. */
export function Gauge({
  value,
  label,
  size = "md",
  className,
}: {
  value: number;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const tone = toneForValue(clamped);
  const dimension = size === "sm" ? 64 : 96;
  const strokeWidth = size === "sm" ? 6 : 8;
  const radius = (dimension - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className={cn("inline-flex flex-col items-center gap-1", className)}>
      <svg width={dimension} height={dimension} viewBox={`0 0 ${dimension} ${dimension}`}>
        <circle
          cx={dimension / 2}
          cy={dimension / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--card-inset))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={dimension / 2}
          cy={dimension / 2}
          r={radius}
          fill="none"
          stroke={strokeVar[tone]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${dimension / 2} ${dimension / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-mono"
          fontSize={size === "sm" ? 13 : 16}
          fontWeight={600}
        >
          {clamped}%
        </text>
      </svg>
      {label && <span className="text-[11px] text-muted">{label}</span>}
    </div>
  );
}
