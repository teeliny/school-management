import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "../../../lib/server-cookies";

/**
 * The only bridge between the httpOnly access-token cookie (`/api/proxy`
 * attaches it server-side for every other request) and client-side JS —
 * Socket.IO's `auth: { token }` handshake is inherently client-side and
 * can't read an httpOnly cookie. Only ever called from inside AppShell,
 * which renders only after useCurrentUser()'s `/auth/me` call has already
 * succeeded (and silently refreshed the cookie via the proxy if it was
 * stale), so the token is fresh by construction — no refresh-retry needed
 * here.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_COOKIE)?.value ?? null;
  if (!token) return NextResponse.json({ token: null }, { status: 401 });
  return NextResponse.json({ token });
}
