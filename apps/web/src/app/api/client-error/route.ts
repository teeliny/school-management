import { NextRequest, NextResponse } from "next/server";

interface ClientErrorPayload {
  message?: string;
  stack?: string;
  digest?: string;
  url?: string;
  userAgent?: string;
}

/**
 * Sink for uncaught client-side exceptions (see error.tsx / global-error.tsx).
 * These land in whatever platform already collects this app's server logs —
 * there's no dedicated error tracker (Sentry etc.) wired up, and affected
 * users are on remote phones with no accessible browser console, so this is
 * the only way to see the real stack trace for a production crash.
 */
export async function POST(req: NextRequest) {
  const body: ClientErrorPayload = await req.json().catch(() => ({}));
  console.error("[client-error]", {
    message: body.message?.slice(0, 500),
    stack: body.stack?.slice(0, 2000),
    digest: body.digest,
    url: body.url?.slice(0, 500),
    userAgent: body.userAgent?.slice(0, 300),
  });
  return NextResponse.json({ ok: true });
}
