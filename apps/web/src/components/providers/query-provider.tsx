"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "../../lib/api";

/**
 * Shared cache/dedup layer for GET requests (apiFetch stays the transport,
 * this just wraps it). refetchOnWindowFocus is off — nothing in this app
 * relied on that behavior before react-query existed, so leaving v5's
 * default on would silently start firing a burst of requests on every tab
 * refocus. Retries skip 401/403/404 since those never succeed under this
 * cookie-auth model (a 401 means /auth/me will redirect to /login anyway).
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) =>
              !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 2,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
