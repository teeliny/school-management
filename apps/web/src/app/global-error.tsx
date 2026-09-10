"use client";

import { useEffect } from "react";
import "./globals.css";
import { isBrowserOutdated } from "../lib/browser-support";
import { reportClientError } from "../lib/report-client-error";

/**
 * Last-resort boundary for an error thrown by the root layout itself (rare —
 * most crashes are caught by app/error.tsx instead). Next.js requires this
 * file to render its own <html>/<body>; it replaces the root layout entirely,
 * so it can't rely on providers/fonts from layout.tsx — only the shared
 * globals.css import, which is safe (no JS) to pull in directly.
 */
export default function GlobalError({
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
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center p-5">
          <div className="w-[420px] max-w-full rounded-card border border-border bg-card px-8 py-8 text-center">
            <h1 className="mb-2 text-lg font-semibold">Something went wrong</h1>
            <p className="mb-5 text-[12.5px] leading-relaxed text-muted">
              {outdated
                ? "This page couldn't load, most likely because your browser is out of date. Please update Chrome (or another browser) and try again."
                : "The app ran into an unexpected error. Try again, or go back to the homepage."}
            </p>
            <div className="flex justify-center gap-2">
              <button
                className="rounded-lg border border-border bg-card px-[15px] py-2 text-[12.5px] font-medium"
                onClick={() => (window.location.href = "/")}
              >
                Go home
              </button>
              <button
                className="rounded-lg border border-primary bg-primary px-[15px] py-2 text-[12.5px] font-medium text-primary-foreground"
                onClick={() => reset()}
              >
                Try again
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
