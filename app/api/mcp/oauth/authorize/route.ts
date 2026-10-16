import { authenticated } from "@/lib/server/auth";
import {
  authorization,
  baseUrl,
  save,
  oauthJson,
} from "@/lib/server/mcp-oauth";
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== baseUrl() || !(await authenticated()))
      return oauthJson({ error: "access_denied" }, 403);
    const form = await request.formData();
    const grant = await authorization(
      new URLSearchParams(String(form.get("query") || "")),
    );
    const code = await save("code", grant, 300);
    const redirect = new URL(grant.redirect_uri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", grant.state);
    return oauthJson({ redirect: redirect.toString() });
  } catch {
    return oauthJson({ error: "invalid_request" }, 400);
  }
}
