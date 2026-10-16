import { after } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/server/mcp";
import {
  baseUrl,
  challenge,
  accessScopes,
  oauthJson,
} from "@/lib/server/mcp-oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== baseUrl() && origin !== "https://chatgpt.com")
      return oauthJson({ error: "Invalid origin." }, 403);
    const scopes = await accessScopes(request);
    if (!scopes)
      return Response.json(
        { error: "Connect your SpendDesk account." },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": challenge(),
            "Cache-Control": "no-store",
          },
        },
      );
    if (Number(request.headers.get("content-length")) > 65536)
      return oauthJson({ error: "Request too large." }, 413);
    const server = createMcpServer({
      scopes,
      scheduleRefresh: (work) => after(work),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } finally {
      await server.close();
    }
  } catch {
    return oauthJson({ error: "MCP is temporarily unavailable." }, 503);
  }
}
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
