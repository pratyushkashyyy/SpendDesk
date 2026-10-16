import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { db, getSetting } from "../../lib/server/db";
import { encrypt } from "../../lib/server/crypto";
import { checkConnections } from "../../lib/server/check-connections";
import { randomUUID } from "node:crypto";
import { googleAccess } from "../../lib/server/google";
import { shopGraphql } from "../../lib/server/shopify";
import { saveGoogleConnection } from "../../lib/server/google-connections";
const local = JSON.parse(readFileSync(".local/config.json", "utf8"));
const base = `postgresql://storedesk:${encodeURIComponent(local.DB_PASSWORD)}@127.0.0.1:55432/`;
const admin = postgres(base + "storedesk");
if (
  !(
    await admin`SELECT datname FROM pg_database WHERE datname='storedesk_health_test'`
  ).length
)
  await admin.unsafe("CREATE DATABASE storedesk_health_test");
await admin.end();
process.env.DATABASE_URL = base + "storedesk_health_test";
process.env.ENCRYPTION_KEY = local.ENCRYPTION_KEY;
const sql = db();
for (const file of ["001_initial", "002_dynamic_google"])
  await sql.unsafe(readFileSync(`db/migrations/${file}.sql`, "utf8"));
await sql`TRUNCATE stores,google_connections,settings CASCADE`;
test("Provider checks persist revoked authorization, permission issues, recovery and reconnect resets", async () => {
  const original = globalThis.fetch;
  let googleExpired = true,
    shopMode = "expired";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json(
        googleExpired
          ? {
              error: "invalid_grant",
              error_description: "never expose upstream detail",
            }
          : { access_token: "private-fixture-token" },
        { status: googleExpired ? 400 : 200 },
      );
    if (url.includes("health-fixture.myshopify.com")) {
      if (shopMode === "expired")
        return Response.json({ errors: "invalid token" }, { status: 401 });
      if (shopMode === "permissions")
        return Response.json({
          errors: [{ extensions: { code: "ACCESS_DENIED" } }],
        });
      return Response.json({ data: { shop: { id: "fixture-shop" } } });
    }
    throw new Error("Unexpected provider request");
  };
  try {
    await sql`INSERT INTO settings(key,value) VALUES('google_config',${encrypt({ clientId: "fixture", clientSecret: "private-secret" })})`;
    await sql`INSERT INTO google_connections(group_id,email,token_cipher) VALUES(3,'health@example.test',${encrypt({ refreshToken: "private-refresh" })})`;
    await assert.rejects(
      () => googleAccess(3),
      /Reconnect this same Google account/,
    );
    const googleHealth = JSON.parse(
      (await getSetting("connection_health:google:3"))!,
    );
    assert.equal(googleHealth.status, "reauthorization_required");
    assert.equal(googleHealth.message.includes("never expose"), false);
    googleExpired = false;
    await googleAccess(3);
    assert.equal(
      JSON.parse((await getSetting("connection_health:google:3"))!).status,
      "healthy",
    );
    await saveGoogleConnection("health@example.test", "new-private-refresh", 3);
    assert.equal(
      JSON.parse((await getSetting("connection_health:google:3"))!).status,
      "unchecked",
    );
    await assert.rejects(
      () =>
        shopGraphql(
          "health-fixture.myshopify.com",
          "private-shop-token",
          "query {shop{id}}",
        ),
      /authorization is invalid or expired/,
    );
    assert.equal(
      JSON.parse(
        (await getSetting(
          "connection_health:shop:health-fixture.myshopify.com",
        ))!,
      ).status,
      "reauthorization_required",
    );
    shopMode = "permissions";
    await assert.rejects(
      () =>
        shopGraphql(
          "health-fixture.myshopify.com",
          "private-shop-token",
          "query {shop{id}}",
        ),
      /permissions are missing/,
    );
    assert.equal(
      JSON.parse(
        (await getSetting(
          "connection_health:shop:health-fixture.myshopify.com",
        ))!,
      ).status,
      "attention",
    );
    shopMode = "healthy";
    await shopGraphql(
      "health-fixture.myshopify.com",
      "private-shop-token",
      "query {shop{id}}",
    );
    assert.equal(
      JSON.parse(
        (await getSetting(
          "connection_health:shop:health-fixture.myshopify.com",
        ))!,
      ).status,
      "healthy",
    );
    await sql`INSERT INTO stores(id,name,domain,cid,group_id,shop_cipher) VALUES(${randomUUID()},'Health fixture','health-fixture.myshopify.com','1234567890',3,${encrypt({ accessToken: "private-shop-token" })})`;
    googleExpired = true;
    await checkConnections();
    const checked = JSON.parse((await getSetting("connection_check_status"))!);
    assert.equal(checked.running, false);
    assert.equal(checked.checked, 2);
    assert.equal(checked.errors, 1);
    assert.equal(
      JSON.parse((await getSetting("connection_health:google:3"))!).status,
      "reauthorization_required",
    );
    const saved =
      await sql`SELECT value FROM settings WHERE key LIKE 'connection_health:%'`;
    assert.equal(JSON.stringify(saved).includes("private-"), false);
  } finally {
    globalThis.fetch = original;
    await sql.end();
  }
});
