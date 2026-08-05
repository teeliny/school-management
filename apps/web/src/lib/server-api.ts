import "server-only";
import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "./server-cookies";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * For Server Components/Server Actions that need authenticated data server-side.
 * Deliberately does NOT attempt refresh-and-retry on a 401: only Route Handlers,
 * Server Actions, and Middleware can persist cookies in Next.js's model, and a
 * plain Server Component render can't. Treat a thrown 401 here as "not
 * authenticated" and redirect, rather than retrying — the access-token cookie
 * gets refreshed via the /api/proxy route on the client's next request instead.
 */
export async function serverApiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;

  const res = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? "Request failed");
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
