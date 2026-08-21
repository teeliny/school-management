import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE, setAuthCookies, clearAuthCookies } from "../../../../lib/server-cookies";
import { checkApiReachable } from "../../../../lib/warmup-server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function forwardJson(method: string, path: string[], search: string, bodyText: string, accessToken: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return fetch(`${API_BASE_URL}/api/v1/${path.join("/")}${search}`, {
    method,
    headers,
    body: bodyText || undefined,
  });
}

// The manual-bank-transfer proof-of-payment upload (the app's first file
// upload) — passing a FormData object straight to fetch makes undici
// re-encode it with a fresh boundary, so there's no manual byte handling.
// No Content-Type header here: fetch sets `multipart/form-data;
// boundary=...` itself when the body is a FormData and the header is unset.
function forwardMultipart(method: string, path: string[], search: string, formData: FormData, accessToken: string | null) {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return fetch(`${API_BASE_URL}/api/v1/${path.join("/")}${search}`, {
    method,
    headers,
    body: formData,
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
  if (!(await checkApiReachable())) {
    return NextResponse.json({ warming: true }, { status: 503 });
  }

  const { path } = await context.params;
  const search = req.nextUrl.search;
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value ?? null;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value ?? null;

  // Read the body once, in whichever shape it arrived as, then reuse it for
  // both the initial attempt and a 401-triggered retry below (the original
  // request stream is single-read, but the parsed FormData/text is not).
  const isMultipart = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  const bodyText = isMultipart ? null : await req.text();
  const formData = isMultipart ? await req.formData() : null;
  const send = (token: string | null) =>
    isMultipart ? forwardMultipart(req.method, path, search, formData!, token) : forwardJson(req.method, path, search, bodyText!, token);

  let apiRes = await send(accessToken);

  if (apiRes.status === 401 && refreshToken) {
    const refreshRes = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (refreshRes.ok) {
      const tokens: { accessToken: string; refreshToken: string } = await refreshRes.json();
      apiRes = await send(tokens.accessToken);
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
