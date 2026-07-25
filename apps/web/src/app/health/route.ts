import { NextResponse } from "next/server";
import type { HealthResponse } from "@school/types";

export function GET() {
  const body: HealthResponse = { status: "ok", service: "web" };
  return NextResponse.json(body);
}
