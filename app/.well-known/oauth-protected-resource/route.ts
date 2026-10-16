import {
  baseUrl,
  resourceUrl,
  supportedScopes,
  oauthJson,
} from "@/lib/server/mcp-oauth";
export function GET() {
  return oauthJson({
    resource: resourceUrl(),
    authorization_servers: [baseUrl()],
    scopes_supported: supportedScopes,
    bearer_methods_supported: ["header"],
  });
}
