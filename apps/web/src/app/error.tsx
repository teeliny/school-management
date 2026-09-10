"use client";

import { useEffect } from "react";
import { Button } from "../components/atoms/button";
import { isBrowserOutdated } from "../lib/browser-support";
import { reportClientError } from "../lib/report-client-error";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  const outdated = isBrowserOutdated();

  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      <div className="w-[420px] max-w-full rounded-card border border-border bg-card px-8 py-8 text-center">
        <h1 className="font-display mb-2 text-lg font-semibold">Something went wrong</h1>
        <p className="mb-5 text-[12.5px] leading-relaxed text-muted">
          {outdated
            ? "This page couldn't load, most likely because your browser is out of date. Please update Chrome (or another browser) and try again."
            : "This page ran into an unexpected error. Try again, or go back to the homepage."}
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => (window.location.href = "/")}>
            Go home
          </Button>
          <Button onClick={() => reset()}>Try again</Button>
        </div>
      </div>
    </main>
  );
}
