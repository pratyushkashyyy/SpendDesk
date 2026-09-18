import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { guard } from "@/lib/server/auth";
import { googleConfig } from "@/lib/server/google";
import { db } from "@/lib/server/db";
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const url = new URL(request.url),
    requested = url.searchParams.get("group"),
    group = requested === null ? null : Number(requested);
  if (
    group !== null &&
    (!Number.isSafeInteger(group) || group < 1 || group > 2147483647)
  )
    return Response.json(
      { error: "Choose a valid Google account." },
      { status: 400 },
    );
  try {
    const config = await googleConfig();
    if (group !== null) {
      const existing =
        await db()`SELECT group_id FROM google_connections WHERE group_id=${group}`;
      if (!existing.length)
        return Response.json(
          { error: "Google account not found." },
          { status: 404 },
        );
    }
    if (!process.env.APP_URL)
      throw new Error("Configure the dashboard URL first.");
    const state = randomBytes(32).toString("hex");
    await db()`DELETE FROM oauth_states WHERE expires_at < now()`;
    await db()`INSERT INTO oauth_states(state,group_id,expires_at) VALUES(${state},${group},now()+interval '10 minutes')`;
    const destination = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    destination.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: `${process.env.APP_URL}/api/google/callback`,
      response_type: "code",
      scope:
        "https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/userinfo.email",
      access_type: "offline",
      prompt: "consent select_account",
      state,
    }).toString();
    const response = NextResponse.redirect(destination);
    response.cookies.set("google_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.redirect(
      new URL("/?view=connections&notice=google-setup-required", request.url),
    );
  }
}
