import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { REFRESH_COOKIE, clearAuthCookies } from "../../../../lib/server-cookies";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function POST() {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }

  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res);
  return res;
}
