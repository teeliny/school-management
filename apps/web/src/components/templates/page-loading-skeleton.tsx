import { Skeleton } from "../atoms/skeleton";

/**
 * Shown in place of every page's old bare "Loading…" text while
 * useCurrentUser() resolves — i.e. before AppShell itself can mount (no
 * user yet to pass it). Mirrors AppShell's actual chrome (sidebar rail
 * width/position, topbar icon row, main's margin/padding) so there's no
 * layout jump once the real shell replaces it, plus a generic
 * title+tabs+card placeholder for the content area every page fills in
 * differently.
 */
export function PageLoadingSkeleton() {
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col gap-5 border-r border-[rgb(var(--primary-foreground)/0.16)] bg-primary px-4 py-6 md:flex">
        <div className="h-8 w-8 rounded-full bg-primary-foreground/15" />
        <div className="flex flex-1 flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 w-8 rounded-md bg-primary-foreground/10" />
          ))}
        </div>
      </aside>

      <main className="max-w-full px-5 pb-14 pt-5 sm:px-8 sm:pt-6 md:ml-[72px]">
        <div className="mb-5 flex items-center justify-between gap-3 md:justify-end">
          <Skeleton className="h-[34px] w-[34px] rounded-full md:hidden" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-[34px] w-[34px] rounded-full" />
            <Skeleton className="h-[34px] w-[34px] rounded-full" />
            <Skeleton className="h-[34px] w-[34px] rounded-full" />
          </div>
        </div>

        <div className="mb-5 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-7 w-56" />
        </div>

        <div className="mb-4 flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-28 rounded-md" />
          ))}
        </div>

        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      </main>
    </div>
  );
}
