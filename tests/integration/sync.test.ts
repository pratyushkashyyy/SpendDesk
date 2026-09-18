import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { db, putSetting, getSetting } from "../../lib/server/db";
import { saveGoogleConnection } from "../../lib/server/google-connections";
import { encrypt, decrypt } from "../../lib/server/crypto";
import { syncReports } from "../../lib/server/sync";
import { dateInZone } from "../../lib/reporting";

// Integration fixtures live in a separate local database, never Railway or the user database.
const url = new URL(process.env.DATABASE_URL || "");
if (url.hostname !== "127.0.0.1" || url.port !== "55432")
  throw new Error(
    "Integration tests require the isolated local PostgreSQL runtime.",
  );
const admin = postgres(process.env.DATABASE_URL!);
const existing =
  await admin`SELECT datname FROM pg_database WHERE datname='storedesk_test'`;
if (!existing.length) await admin.unsafe("CREATE DATABASE storedesk_test");
await admin.end();
url.pathname = "/storedesk_test";
process.env.DATABASE_URL = url.toString();
const sql = db();
await sql.unsafe(
  await readFile(
    new URL("../../db/migrations/001_initial.sql", import.meta.url),
    "utf8",
  ),
);
await sql.unsafe(
  await readFile(
    new URL("../../db/migrations/002_dynamic_google.sql", import.meta.url),
    "utf8",
  ),
);
await sql`TRUNCATE reports,stores,google_connections,settings,oauth_states,auth_attempts`;

test("real PostgreSQL sync stores provider values, preserves snapshots on failures, and prevents overlapping jobs", async () => {
  const id = randomUUID(),
    original = globalThis.fetch;
  let failAds = false;
  await putSetting(
    "google_config",
    encrypt({
      clientId: "qa-client",
      clientSecret: "qa-secret",
      developerToken: "qa-token",
    }),
  );
  await sql`INSERT INTO google_connections(group_id,email,token_cipher) VALUES(3,'qa@example.test',${encrypt({ refreshToken: "qa-refresh" })})`;
  await sql`INSERT INTO stores(id,name,domain,cid,group_id,shop_cipher) VALUES(${id},'Integration fixture','qa.myshopify.com','1234567890',3,${encrypt({ accessToken: "qa-shop-token" })})`;
  await sql`SELECT setval('google_connection_id_seq',3)`;
  assert.equal(
    await saveGoogleConnection("FOURTH@example.test", "initial-refresh", null),
    true,
  );
  assert.equal(
    await saveGoogleConnection("fourth@example.test", "updated-refresh", null),
    true,
  );
  const [fourth] =
    await sql`SELECT group_id,token_cipher FROM google_connections WHERE email='fourth@example.test'`;
  assert.equal(fourth.group_id, 4);
  assert.equal(
    decrypt<{ refreshToken: string }>(fourth.token_cipher).refreshToken,
    "updated-refresh",
  );
  assert.equal(
    await saveGoogleConnection("wrong@example.test", "wrong-refresh", 3),
    false,
  );
  assert.equal(
    await saveGoogleConnection("qa@example.test", "qa-refresh", 3),
    true,
  );
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    if (target.includes("oauth2.googleapis.com"))
      return Response.json({ access_token: "qa-access" });
    const body = JSON.parse(String(init?.body));
    if (target.includes("googleads.googleapis.com")) {
      if (failAds)
        return Response.json({ error: "not authorized" }, { status: 403 });
      const q = body.query;
      if (q.includes("customer.currency_code"))
        return Response.json({
          results: [
            {
              customer: {
                currencyCode: "USD",
                timeZone: "America/Los_Angeles",
              },
            },
          ],
        });
      if (q.includes("conversion_action_category"))
        return Response.json({
          results: [
            {
              segments: { conversionActionCategory: "PURCHASE" },
              metrics: { conversions: 3.5 },
            },
          ],
        });
      if (q.includes("cost_per_conversion"))
        return Response.json({
          results: [
            {
              metrics: {
                costMicros: "105000000",
                costPerConversion: "30000000",
                conversions: 3.5,
              },
            },
          ],
        });
      return Response.json({
        results: [
          {
            campaign: { id: "1", name: "Fixture shopping", status: "ENABLED" },
            campaignBudget: {
              id: "daily",
              name: "Fixture budget",
              amountMicros: "200000000",
              period: "DAILY",
              explicitlyShared: false,
            },
            metrics: { costMicros: "105000000" },
          },
        ],
      });
    }
    return Response.json({
      data: {
        shop: {
          name: "Fixture",
          currencyCode: "INR",
          ianaTimezone: "Asia/Kolkata",
        },
        ...(body.query.includes("shopifyqlQuery")
          ? {
              shopifyqlQuery: {
                parseErrors: [],
                tableData: {
                  columns: [{ name: "total_sales" }, { name: "orders" }],
                  rows: [{ total_sales: "8765.43", orders: "9" }],
                },
              },
            }
          : {}),
      },
    });
  };
  try {
    const first = await syncReports();
    assert.equal(first.synced, 8);
    assert.equal(first.errors, 0);
    const rows =
      await sql`SELECT source,report_date::text,payload,error FROM reports WHERE store_id=${id}`;
    assert.equal(rows.length, 8);
    const ads = rows.find(
      (r) =>
        r.source === "ads" &&
        r.report_date === dateInZone("America/Los_Angeles"),
    );
    assert.equal(ads!.payload.spend, 105);
    assert.equal(ads!.payload.purchases, 3.5);
    assert.equal(ads!.payload.costPerPurchase, 30);
    const shop = rows.find((r) => r.source === "shop");
    assert.equal(shop!.payload.sales, 8765.43);
    assert.equal(shop!.payload.orders, 9);
    const lock = await sql.reserve();
    await lock`SELECT pg_advisory_lock(734052)`;
    assert.equal((await syncReports()).busy, true);
    await lock`SELECT pg_advisory_unlock(734052)`;
    lock.release();
    failAds = true;
    const second = await syncReports();
    assert.equal(second.errors, 4);
    assert.equal(second.synced, 4);
    const [preserved] =
      await sql`SELECT payload,error FROM reports WHERE store_id=${id} AND source='ads' AND report_date=${dateInZone("America/Los_Angeles")}`;
    assert.equal(preserved.payload.spend, 105);
    assert.ok(preserved.error);
    const status = JSON.parse((await getSetting("sync_status"))!);
    assert.equal(status.running, false);
    assert.equal(status.errors, 4);
    assert.ok(status.finishedAt);
    const [cipher] =
      await sql`SELECT token_cipher FROM google_connections WHERE group_id=3`;
    assert.ok(!cipher.token_cipher.includes("qa-refresh"));
  } finally {
    globalThis.fetch = original;
    await sql`TRUNCATE reports,stores,google_connections,settings,oauth_states,auth_attempts`;
    await sql.end();
  }
});
