import { createHash, randomBytes } from "node:crypto";
import type postgres from "postgres";
import { db } from "./db";
import { equal } from "./crypto";
export const scope = "dashboard:read";
export const refreshScope = "dashboard:refresh";
export const supportedScopes = [scope, refreshScope];
export function parseScopes(value: string): string[] | null {
  const scopes = [...new Set(value.split(" ").filter(Boolean))];
  return scopes.includes(scope) &&
    scopes.every((s) => supportedScopes.includes(s))
    ? supportedScopes.filter((s) => scopes.includes(s))
    : null;
}
export function baseUrl() {
  if (!process.env.APP_URL) throw new Error("APP_URL is required for MCP.");
  return new URL(process.env.APP_URL).origin;
}
export function resourceUrl() {
  return `${baseUrl()}/mcp`;
}
export function digest(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}
export function allowedRedirect(value: string) {
  try {
    const u = new URL(value);
    return (
      u.origin === "https://chatgpt.com" &&
      !u.hash &&
      !u.search &&
      (u.pathname === "/connector_platform_oauth_redirect" ||
        /^\/connector\/oauth\/[a-zA-Z0-9_-]+$/.test(u.pathname))
    );
  } catch {
    return false;
  }
}
export async function save(
  kind: string,
  payload: Record<string, postgres.JSONValue>,
  seconds: number,
) {
  const token = randomBytes(32).toString("base64url");
  await db()`INSERT INTO mcp_oauth(id,kind,payload,expires_at) VALUES(${digest(token)},${kind},${db().json(payload)},now()+${seconds}*interval '1 second')`;
  return token;
}
export async function lookup(token: string, kind: string) {
  const [row] =
    await db()`SELECT payload FROM mcp_oauth WHERE id=${digest(token)} AND kind=${kind} AND expires_at>now()`;
  return row?.payload;
}
export async function authorization(params: URLSearchParams) {
  const client = await lookup(params.get("client_id") || "", "client");
  const redirect = params.get("redirect_uri") || "";
  if (
    !client ||
    !client.redirect_uris.includes(redirect) ||
    !allowedRedirect(redirect) ||
    params.get("response_type") !== "code" ||
    params.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") || "") ||
    params.get("resource") !== resourceUrl() ||
    !parseScopes(params.get("scope") || "") ||
    !params.get("state") ||
    params.get("state")!.length > 1024
  )
    throw new Error("Invalid authorization request.");
  return {
    client_id: params.get("client_id")!,
    redirect_uri: redirect,
    challenge: params.get("code_challenge")!,
    resource: resourceUrl(),
    scope: parseScopes(params.get("scope") || "")!.join(" "),
    state: params.get("state")!,
  };
}
export function verifyPkce(verifier: string, challenge: string) {
  return (
    /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) &&
    equal(digest(verifier), challenge)
  );
}
export async function accessScopes(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return null;
  const token = await lookup(header.slice(7), "access");
  return token?.resource === resourceUrl() && typeof token.scope === "string"
    ? parseScopes(token.scope)
    : null;
}
export async function validAccess(request: Request) {
  return !!(await accessScopes(request));
}
export function challenge(requiredScope = scope) {
  return `Bearer resource_metadata="${baseUrl()}/.well-known/oauth-protected-resource", scope="${requiredScope}"`;
}
export function oauthJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}
