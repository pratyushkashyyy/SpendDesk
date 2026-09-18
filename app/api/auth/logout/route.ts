import { NextResponse } from "next/server";
import { guard } from "@/lib/server/auth";
export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("storedesk_session");
  return response;
}
