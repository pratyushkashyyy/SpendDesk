import { db } from "@/lib/server/db";
import { allowedRedirect, save, oauthJson } from "@/lib/server/mcp-oauth";
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 8192)
      return oauthJson({ error: "invalid_client_metadata" }, 400);
    const body = await request.json();
    if (
      !Array.isArray(body.redirect_uris) ||
      body.redirect_uris.length < 1 ||
      body.redirect_uris.length > 5 ||
      !body.redirect_uris.every(
        (u: unknown) => typeof u === "string" && allowedRedirect(u),
      ) ||
      (body.token_endpoint_auth_method &&
        body.token_endpoint_auth_method !== "none")
    )
      return oauthJson({ error: "invalid_client_metadata" }, 400);
    const [limit] =
      await db()`INSERT INTO auth_attempts(key,attempts,resets_at) VALUES('mcp-register',1,now()+interval '1 hour') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.resets_at<now() THEN 1 ELSE auth_attempts.attempts+1 END,resets_at=CASE WHEN auth_attempts.resets_at<now() THEN now()+interval '1 hour' ELSE auth_attempts.resets_at END RETURNING attempts`;
    if (limit.attempts > 100)
      return oauthJson({ error: "temporarily_unavailable" }, 429);
    await db()`DELETE FROM mcp_oauth WHERE expires_at<now()`;
    const client_id = await save(
      "client",
      { redirect_uris: body.redirect_uris },
      365 * 86400,
    );
    return oauthJson(
      {
        client_id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: body.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  } catch {
    return oauthJson({ error: "invalid_client_metadata" }, 400);
  }
}
