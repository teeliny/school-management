import type { ReactNode } from "react";

/** Shared page-top banner for every public marketing page (About/Academics/Admissions/Careers). Home builds its own larger hero inline. */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <section className="border-b border-border bg-card-inset">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:py-16">
        <div className="text-[10.5px] uppercase tracking-wide text-muted">{eyebrow}</div>
        <h1 className="font-display mt-2 text-3xl font-semibold sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted">{subtitle}</p>}
        {children}
      </div>
    </section>
  );
}
