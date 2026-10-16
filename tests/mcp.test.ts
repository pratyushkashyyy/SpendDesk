import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  allowedRedirect,
  digest,
  verifyPkce,
  parseScopes,
} from "../lib/server/mcp-oauth";
import { cleanPayload, validateRange } from "../lib/server/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../lib/server/mcp";
test("OAuth accepts only exact ChatGPT callback destinations", () => {
  assert.equal(
    allowedRedirect("https://chatgpt.com/connector_platform_oauth_redirect"),
    true,
  );
  assert.equal(
    allowedRedirect("https://chatgpt.com/connector/oauth/abc-123"),
    true,
  );
  for (const u of [
    "https://chatgpt.com.evil.test/connector_platform_oauth_redirect",
    "http://chatgpt.com/connector_platform_oauth_redirect",
    "https://evil.test/callback",
    "https://chatgpt.com/connector/oauth/x?redirect=evil",
    "https://chatgpt.com/connector/oauth/x#bad",
  ])
    assert.equal(allowedRedirect(u), false);
});
test("PKCE requires the matching valid S256 verifier", () => {
  const verifier = randomBytes(32).toString("base64url");
  assert.equal(verifyPkce(verifier, digest(verifier)), true);
  assert.equal(
    verifyPkce(randomBytes(32).toString("base64url"), digest(verifier)),
    false,
  );
  assert.equal(verifyPkce("short", digest("short")), false);
});
test("MCP report output removes raw payloads and hidden sales recursively", () => {
  assert.deepEqual(
    cleanPayload({
      orders: 2,
      sales: 100,
      raw: { secret: "private" },
      nested: [{ total_sales: 3, spend: null }],
    }),
    { orders: 2, nested: [{ spend: null }] },
  );
});
test("Date ranges reject invalid dates, reverse ranges and excessive spans", () => {
  validateRange("2026-01-01", "2026-12-31");
  for (const r of [
    ["2026-02-30", "2026-03-01"],
    ["2026-10-10", "2026-10-09"],
    ["2025-01-01", "2026-01-02"],
  ])
    assert.throws(() => validateRange(r[0], r[1]));
});
test("MCP distinguishes report reads from the refresh action", async () => {
  const server = createMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 5);
    for (const tool of tools.filter((tool) => tool.name !== "refresh_data")) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.deepEqual(tool._meta?.securitySchemes, [
        { type: "oauth2", scopes: ["dashboard:read"] },
      ]);
    }
    process.env.APP_URL = "http://127.0.0.1:3100";
    const refresh = tools.find((tool) => tool.name === "refresh_data")!;
    assert.equal(refresh.annotations?.readOnlyHint, false);
    const denied = await client.callTool({
      name: "refresh_data",
      arguments: {},
    });
    assert.equal(denied.isError, true);
    assert.ok(denied._meta?.["mcp/www_authenticate"]);
    const invalid = await client.callTool({
      name: "get_store_reports",
      arguments: { from: "2026-02-30", to: "2026-03-01" },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("OAuth scope parsing preserves read-only grants and rejects unknown privileges", () => {
  assert.deepEqual(parseScopes("dashboard:read"), ["dashboard:read"]);
  assert.deepEqual(parseScopes("dashboard:refresh dashboard:read"), [
    "dashboard:read",
    "dashboard:refresh",
  ]);
  assert.equal(parseScopes("dashboard:refresh"), null);
  assert.equal(parseScopes("dashboard:read dashboard:admin"), null);
});
