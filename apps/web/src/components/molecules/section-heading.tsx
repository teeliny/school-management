import { cn } from "../../lib/cn";

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("mb-8", align === "center" && "text-center")}>
      {eyebrow && <div className="text-[10.5px] uppercase tracking-wide text-muted">{eyebrow}</div>}
      <h2 className="font-display mt-1 text-2xl font-semibold sm:text-[26px]">{title}</h2>
      {subtitle && (
        <p className={cn("mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-muted", align === "center" && "mx-auto")}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
