import { db } from "@/lib/server/db";
import {
  digest,
  lookup,
  parseScopes,
  oauthJson,
  resourceUrl,
  save,
  verifyPkce,
} from "@/lib/server/mcp-oauth";
export async function POST(request: Request) {
  try {
    const p = new URLSearchParams(await request.text());
    const kind =
      p.get("grant_type") === "authorization_code"
        ? "code"
        : p.get("grant_type") === "refresh_token"
          ? "refresh"
          : null;
    if (!kind) return oauthJson({ error: "unsupported_grant_type" }, 400);
    const raw = p.get(kind === "code" ? "code" : "refresh_token") || "";
    const grant = await lookup(raw, kind);
    if (
      !grant ||
      grant.client_id !== p.get("client_id") ||
      p.get("resource") !== resourceUrl() ||
      (p.get("scope") &&
        (!parseScopes(p.get("scope")!) ||
          parseScopes(p.get("scope")!)!.join(" ") !==
            parseScopes(grant.scope)?.join(" "))) ||
      (kind === "code" &&
        (grant.redirect_uri !== p.get("redirect_uri") ||
          !verifyPkce(p.get("code_verifier") || "", grant.challenge)))
    )
      return oauthJson({ error: "invalid_grant" }, 400);
    // Delete atomically: concurrent requests cannot redeem the same code/refresh token.
    const rows =
      await db()`DELETE FROM mcp_oauth WHERE id=${digest(raw)} AND kind=${kind} AND expires_at>now() RETURNING id`;
    if (!rows.length) return oauthJson({ error: "invalid_grant" }, 400);
    const payload = {
      client_id: grant.client_id,
      resource: grant.resource,
      scope: grant.scope,
    };
    const access_token = await save("access", payload, 3600);
    const refresh_token = await save("refresh", payload, 30 * 86400);
    return oauthJson({
      access_token,
      refresh_token,
      token_type: "Bearer",
      expires_in: 3600,
      scope: grant.scope,
    });
  } catch {
    return oauthJson({ error: "temporarily_unavailable" }, 503);
  }
}
