import { db } from "@/lib/server/db";
import { digest, oauthJson } from "@/lib/server/mcp-oauth";
export async function POST(request: Request) {
  const p = new URLSearchParams(await request.text());
  await db()`DELETE FROM mcp_oauth WHERE id=${digest(p.get("token") || "")} AND kind IN ('access','refresh') AND payload->>'client_id'=${p.get("client_id") || ""}`;
  return oauthJson({});
}
