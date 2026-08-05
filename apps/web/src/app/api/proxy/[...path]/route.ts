import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, setAuthCookies, clearAuthCookies } from "../../../../lib/server-cookies";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function forward(method: string, path: string[], search: string, bodyText: string, accessToken: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return fetch(`${API_BASE_URL}/api/v1/${path.join("/")}${search}`, {
    method,
    headers,
    body: bodyText || undefined,
  });
}

async function toResponse(apiRes: Response): Promise<NextResponse> {
  const text = await apiRes.text();
  return new NextResponse(apiRes.status === 204 || text === "" ? null : text, {
    status: apiRes.status,
    headers: { "Content-Type": apiRes.headers.get("Content-Type") ?? "application/json" },
  });
}

async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const bodyText = await req.text();
  const search = req.nextUrl.search;
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value ?? null;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value ?? null;

  let apiRes = await forward(req.method, path, search, bodyText, accessToken);

  if (apiRes.status === 401 && refreshToken) {
    const refreshRes = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (refreshRes.ok) {
      const tokens: { accessToken: string; refreshToken: string } = await refreshRes.json();
      apiRes = await forward(req.method, path, search, bodyText, tokens.accessToken);
      const res = await toResponse(apiRes);
      setAuthCookies(res, tokens);
      return res;
    }

    const res = await toResponse(apiRes);
    clearAuthCookies(res);
    return res;
  }

  return toResponse(apiRes);
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
