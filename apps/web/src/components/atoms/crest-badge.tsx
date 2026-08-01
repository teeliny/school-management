import { cn } from "../../lib/cn";

export interface CrestBadgeProps {
  letter: string;
  size?: "sm" | "lg";
  variant?: "outline" | "solid";
  className?: string;
}

const sizeClass = {
  sm: "h-[38px] w-[38px] text-sm",
  lg: "h-[52px] w-[52px] text-lg",
};

export function CrestBadge({ letter, size = "sm", variant = "outline", className }: CrestBadgeProps) {
  return (
    <div
      className={cn(
        "relative flex flex-none items-center justify-center rounded-full",
        sizeClass[size],
        variant === "outline"
          ? "border-[1.5px] border-[rgb(var(--primary-foreground)/0.55)] text-primary-foreground " +
              "before:absolute before:inset-1 before:rounded-full before:border before:border-[rgb(var(--primary-foreground)/0.35)]"
          : "border border-primary bg-primary text-primary-foreground",
        className,
      )}
    >
      <span className="font-display font-semibold">{letter}</span>
    </div>
  );
}
