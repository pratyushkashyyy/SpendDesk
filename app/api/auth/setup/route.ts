import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { equal, hashPassword, sessionToken } from "@/lib/server/crypto";
import { cookieOptions } from "@/lib/server/auth";
export async function POST(request: Request) {
  try {
    if (
      request.headers.get("origin") !==
      new URL(process.env.APP_URL || request.url).origin
    )
      return Response.json({ error: "Invalid request." }, { status: 403 });
    const { token, password } = await request.json();
    if (
      typeof token !== "string" ||
      !process.env.SETUP_TOKEN ||
      !equal(token, process.env.SETUP_TOKEN)
    )
      return Response.json(
        { error: "Use your private setup link." },
        { status: 403 },
      );
    if (
      typeof password !== "string" ||
      password.length < 14 ||
      password.length > 256
    )
      return Response.json(
        { error: "Choose a password of 14–256 characters." },
        { status: 400 },
      );
    const result =
      await db()`INSERT INTO settings(key,value) VALUES('owner_password',${hashPassword(password)}) ON CONFLICT(key) DO NOTHING RETURNING key`;
    if (!result.length)
      return Response.json(
        { error: "Your dashboard is already set up. Please sign in." },
        { status: 409 },
      );
    const response = NextResponse.json({ ok: true });
    response.cookies.set("storedesk_session", sessionToken(), cookieOptions());
    return response;
  } catch {
    return Response.json(
      {
        error:
          "Setup is unavailable. Check the database and private setup configuration.",
      },
      { status: 503 },
    );
  }
}
