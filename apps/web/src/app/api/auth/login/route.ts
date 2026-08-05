import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "../../../../lib/server-cookies";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  const body = await req.text();

  const apiRes = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!apiRes.ok) {
    const errorBody = await apiRes.text();
    return new NextResponse(errorBody || null, {
      status: apiRes.status,
      headers: { "Content-Type": apiRes.headers.get("Content-Type") ?? "application/json" },
    });
  }

  const tokens: { accessToken: string; refreshToken: string } = await apiRes.json();
  const res = NextResponse.json({ ok: true });
  setAuthCookies(res, tokens);
  return res;
}
