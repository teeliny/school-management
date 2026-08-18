export function Letterhead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-5">
      <div className="text-[10.5px] uppercase tracking-wide text-muted">{eyebrow}</div>
      <h1 className="font-display mb-2.5 mt-1 text-2xl font-semibold">{title}</h1>
      <div className="border-t-2 border-foreground" />
      <div className="mt-[3px] border-t border-border" />
    </div>
  );
}
