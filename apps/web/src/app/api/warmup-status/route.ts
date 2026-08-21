import { NextResponse } from "next/server";
import { checkApiReachable } from "../../../lib/warmup-server";

export async function GET() {
  return NextResponse.json({ warm: await checkApiReachable() });
}
