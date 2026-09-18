import { NextResponse } from "next/server";
import { db, getSetting } from "@/lib/server/db";
import { verifyPassword, sessionToken } from "@/lib/server/crypto";
import { cookieOptions } from "@/lib/server/auth";
export async function POST(request: Request) {
  try {
    if (
      request.headers.get("origin") !==
      new URL(process.env.APP_URL || request.url).origin
    )
      return Response.json({ error: "Invalid request." }, { status: 403 });
    const { password } = await request.json();
    if (typeof password !== "string" || password.length > 256)
      return Response.json({ error: "Invalid password." }, { status: 400 });
    const [attempt] =
      await db()`INSERT INTO auth_attempts(key,attempts,resets_at) VALUES('owner',1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.resets_at<now() THEN 1 ELSE auth_attempts.attempts+1 END,resets_at=CASE WHEN auth_attempts.resets_at<now() THEN now()+interval '15 minutes' ELSE auth_attempts.resets_at END RETURNING attempts`;
    if (attempt.attempts > 10)
      return Response.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429 },
      );
    const saved = await getSetting("owner_password");
    if (!saved || !verifyPassword(password, saved))
      return Response.json(
        {
          error: "Incorrect password, or initial setup has not been completed.",
        },
        { status: 401 },
      );
    await db()`DELETE FROM auth_attempts WHERE key='owner'`;
    const response = NextResponse.json({ ok: true });
    response.cookies.set("storedesk_session", sessionToken(), cookieOptions());
    return response;
  } catch {
    return Response.json(
      { error: "Sign-in is temporarily unavailable." },
      { status: 503 },
    );
  }
}
