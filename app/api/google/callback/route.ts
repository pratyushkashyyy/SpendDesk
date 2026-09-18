import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { guard } from "@/lib/server/auth";
import { googleConfig } from "@/lib/server/google";
import { db } from "@/lib/server/db";
import { equal } from "@/lib/server/crypto";
import { saveGoogleConnection } from "@/lib/server/google-connections";
import { fetchJson } from "@/lib/server/http";
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const url = new URL(request.url),
    state = url.searchParams.get("state") || "",
    code = url.searchParams.get("code"),
    cookie = (await cookies()).get("google_oauth_state")?.value;
  const done = (notice: string) => {
    const response = NextResponse.redirect(
      new URL(
        `/?view=connections&notice=${notice}`,
        process.env.APP_URL || url.origin,
      ),
    );
    response.cookies.delete("google_oauth_state");
    return response;
  };
  if (!cookie || !equal(cookie, state) || !code)
    return done("google-authorization-cancelled");
  try {
    const states =
      await db()`DELETE FROM oauth_states WHERE state=${state} AND expires_at>now() RETURNING group_id`;
    if (!states.length) return done("google-authorization-expired");
    const config = await googleConfig();
    const token = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: `${process.env.APP_URL}/api/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!token.refresh_token) return done("google-offline-access-required");
    const user = await fetchJson(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    if (!user.email || !user.verified_email)
      throw new Error("Unverified Google identity");
    const saved = await saveGoogleConnection(
      user.email,
      token.refresh_token,
      states[0].group_id,
    );
    if (!saved) return done("choose-the-same-google-account-to-reconnect");
    return done("google-connected");
  } catch {
    return done("google-connection-failed");
  }
}
