"use client";

import { useEffect, useState } from "react";
import { useApiWarmup } from "../../lib/use-api-warmup";

const COUNTDOWN_SECONDS = 90;

/**
 * Mounted once at the root layout so it covers both AppShell and AuthLayout.
 * `fixed` overlay, not pushed into document flow — appears rarely and
 * briefly, so no layout needs to reserve space for it.
 */
export function ApiWarmupBanner() {
  const warmup = useApiWarmup();
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const startedAt = warmup.status === "warming" ? warmup.startedAt : null;

  useEffect(() => {
    if (startedAt === null) return;
    setSecondsLeft(COUNTDOWN_SECONDS);
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (warmup.status !== "warming") return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-warning-bg px-4 py-2 text-sm text-warning">
      <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
      {secondsLeft > 0
        ? `Waking up the server — this can take up to ${secondsLeft}s…`
        : "Still waking up, hang tight…"}
    </div>
  );
}
