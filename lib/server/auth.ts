import { cookies } from "next/headers";
import { validSession } from "./crypto";
export async function authenticated() {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.LOCAL_DEV_AUTH === "true"
  )
    return true;
  return validSession((await cookies()).get("storedesk_session")?.value);
}
export async function guard(request?: Request) {
  if (!(await authenticated()))
    return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const expected = process.env.APP_URL || new URL(request.url).origin;
    if (!origin || origin !== new URL(expected).origin)
      return Response.json(
        { error: "Invalid request origin." },
        { status: 403 },
      );
  }
  return null;
}
export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 86400,
  };
}
