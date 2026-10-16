import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { requestRefresh, getRefreshStatus } from "../../lib/server/mcp-refresh";
import { db } from "../../lib/server/db";
import { digest, save, validAccess } from "../../lib/server/mcp-oauth";
import { POST as token } from "../../app/api/mcp/oauth/token/route";
import { POST as register } from "../../app/api/mcp/oauth/register/route";
import { POST as mcp } from "../../app/mcp/route";
const local = JSON.parse(readFileSync(".local/config.json", "utf8"));
process.env.APP_URL = "http://127.0.0.1:3100";
process.env.DATABASE_URL = `postgresql://storedesk:${encodeURIComponent(local.DB_PASSWORD)}@127.0.0.1:55432/storedesk`;
const admin = postgres(process.env.DATABASE_URL);
if (
  !(
    await admin`SELECT datname FROM pg_database WHERE datname='storedesk_mcp_test'`
  ).length
)
  await admin.unsafe("CREATE DATABASE storedesk_mcp_test");
await admin.end();
process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
  /\/storedesk$/,
  "/storedesk_mcp_test",
);
const sql = db();
for (const file of [
  "001_initial",
  "002_dynamic_google",
  "003_store_products",
  "004_date_ranges",
  "006_mcp_oauth",
  "008_report_observations",
  "009_budget_history",
  "010_campaign_activity",
])
  await sql.unsafe(readFileSync(`db/migrations/${file}.sql`, "utf8"));
await sql`TRUNCATE mcp_oauth,auth_attempts,store_product_snapshots,product_campaign_links,reports,report_ranges,stores CASCADE`;
function exchange(params: Record<string, string>) {
  return token(
    new Request("http://127.0.0.1:3100/api/mcp/oauth/token", {
      method: "POST",
      body: new URLSearchParams(params),
    }),
  );
}
test("OAuth and live MCP transport protect saved reports", async () => {
  try {
    const registration = await register(
      new Request("http://127.0.0.1:3100/api/mcp/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [
            "https://chatgpt.com/connector_platform_oauth_redirect",
          ],
        }),
      }),
    );
    assert.equal(registration.status, 201);
    const { client_id } = await registration.json();
    const verifier = randomBytes(32).toString("base64url");
    const code = await save(
      "code",
      {
        client_id,
        redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
        challenge: digest(verifier),
        scope: "dashboard:read",
        resource: "http://127.0.0.1:3100/mcp",
      },
      300,
    );
    const params = {
      grant_type: "authorization_code",
      code,
      client_id,
      code_verifier: verifier,
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      resource: "http://127.0.0.1:3100/mcp",
    };
    assert.equal(
      (
        await exchange({
          ...params,
          code_verifier: randomBytes(32).toString("base64url"),
        })
      ).status,
      400,
    );
    assert.equal(
      (await exchange({ ...params, resource: "https://evil.test/mcp" })).status,
      400,
    );
    const responses = await Promise.all([exchange(params), exchange(params)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
    const credentials = await responses.find((r) => r.status === 200)!.json();
    assert.equal(
      await validAccess(
        new Request("http://localhost", {
          headers: { Authorization: `Bearer ${credentials.access_token}` },
        }),
      ),
      true,
    );
    assert.equal(
      (await mcp(new Request("http://127.0.0.1:3100/mcp", { method: "POST" })))
        .status,
      401,
    );
    const id = randomUUID();
    await sql`INSERT INTO stores(id,name,domain,cid,group_id) VALUES(${id},'MCP fixture','mcp-fixture.myshopify.com','123',1)`;
    await sql`INSERT INTO reports(store_id,source,report_date,payload) VALUES(${id},'ads','2026-10-10',${sql.json({ spend: 12, currency: "INR", timezone: "Asia/Kolkata", raw: { secret: "must-stay-private" } })})`;
    const res = await mcp(
      new Request("http://127.0.0.1:3100/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "get_store_reports",
            arguments: { from: "2026-10-10", to: "2026-10-10", store_id: id },
          },
        }),
      }),
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(
      data.result.structuredContent.stores[0].sources[0].data.spend,
      12,
    );
    assert.equal(JSON.stringify(data).includes("must-stay-private"), false);
    assert.equal(
      data.result.structuredContent.stores[0].sources[1].available,
      false,
    );
    const refreshed = await exchange({
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
      client_id,
      resource: params.resource,
    });
    assert.equal(refreshed.status, 200);
    assert.equal(
      (
        await exchange({
          grant_type: "refresh_token",
          refresh_token: credentials.refresh_token,
          client_id,
          resource: params.resource,
        })
      ).status,
      400,
    );
    // Test queue deduplication and completion without calling any real provider.
    await sql`DELETE FROM stores`;
    await sql`DELETE FROM settings WHERE key IN ('mcp_refresh_status','sync_status')`;
    const work: Array<() => Promise<void>> = [];
    const queued = await Promise.all([
      requestRefresh("2026-10-10", "2026-10-10", (task) => work.push(task)),
      requestRefresh("2026-10-10", "2026-10-10", (task) => work.push(task)),
    ]);
    assert.equal(queued.filter((r) => r.accepted).length, 1);
    assert.equal(work.length, 1);
    assert.equal((await getRefreshStatus())?.state, "queued");
    await work[0]();
    assert.equal((await getRefreshStatus())?.state, "completed");
    assert.equal((await getRefreshStatus())?.errors, 0);
    // An expired read-only refresh grant cannot be broadened at token exchange.
    const readOnlyRefresh = await save(
      "refresh",
      { client_id, resource: params.resource, scope: "dashboard:read" },
      3600,
    );
    const broadened = await exchange({
      grant_type: "refresh_token",
      refresh_token: readOnlyRefresh,
      client_id,
      resource: params.resource,
      scope: "dashboard:read dashboard:refresh",
    });
    assert.equal(broadened.status, 400);
    const held = await sql.reserve();
    try {
      await held`SELECT pg_advisory_lock(734052)`;
      const busy = await requestRefresh(undefined, undefined, (task) =>
        work.push(task),
      );
      assert.equal(busy.busy, true);
      assert.equal(work.length, 1);
    } finally {
      await held`SELECT pg_advisory_unlock(734052)`;
      held.release();
    }
  } finally {
    await sql.end();
  }
});
