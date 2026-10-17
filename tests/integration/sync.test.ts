import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { db, putSetting, getSetting } from "../../lib/server/db";
import { saveGoogleConnection } from "../../lib/server/google-connections";
import { encrypt, decrypt } from "../../lib/server/crypto";
import { buildExport } from "../../lib/server/export";
import { processExportJobs } from "../../lib/server/export-jobs";
import { storeProducts } from "../../lib/server/store-products";
import { syncReports } from "../../lib/server/sync";
import { googleQuotaScope } from "../../lib/server/google-quota";
import { savedReports } from "../../lib/server/report-cache";
import { reportDates } from "../../lib/report-ranges";
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
await sql.unsafe(
  await readFile(
    new URL("../../db/migrations/003_store_products.sql", import.meta.url),
    "utf8",
  ),
);
await sql.unsafe(
  await readFile(
    new URL("../../db/migrations/004_date_ranges.sql", import.meta.url),
    "utf8",
  ),
);
await sql.unsafe(
  await readFile(
    new URL("../../db/migrations/005_export_jobs.sql", import.meta.url),
    "utf8",
  ),
);
await sql.unsafe(
  await readFile(
    new URL("../../db/migrations/007_google_ads_quota.sql", import.meta.url),
    "utf8",
  ),
);
await sql.unsafe(
  await readFile(
    new URL("../../db/migrations/008_report_observations.sql", import.meta.url),
    "utf8",
  ),
);
await sql`UPDATE google_ads_quota_policy SET spacing_ms=0`;
await sql`TRUNCATE google_ads_operations,google_ads_quota_state`;
await sql`TRUNCATE report_observations,export_jobs, product_campaign_links,store_product_snapshots,report_ranges,reports,stores,google_connections,settings,oauth_states,auth_attempts`;

test(
  "real PostgreSQL sync stores provider values, preserves snapshots on failures, and prevents overlapping jobs",
  { timeout: 60000 },
  async () => {
    const id = randomUUID(),
      original = globalThis.fetch;
    let failAds = false;
    let providerCalls = 0;
    let adsCalls = 0;
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
      await saveGoogleConnection(
        "FOURTH@example.test",
        "initial-refresh",
        null,
      ),
      true,
    );
    assert.equal(
      await saveGoogleConnection(
        "fourth@example.test",
        "updated-refresh",
        null,
      ),
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
      providerCalls++;
      const target = String(input);
      if (target.includes("oauth2.googleapis.com"))
        return Response.json({ access_token: "qa-access" });
      const body = JSON.parse(String(init?.body));
      if (target.includes("googleads.googleapis.com")) {
        adsCalls++;
        if (failAds)
          return Response.json({ error: "not authorized" }, { status: 403 });
        const q = body.query;
        if (/campaign\.(start_date|end_date)\b/.test(q))
          return Response.json(
            {
              error: {
                details: [
                  {
                    errors: [
                      {
                        errorCode: { queryError: "UNRECOGNIZED_FIELD" },
                        message: "Removed campaign date fields",
                      },
                    ],
                  },
                ],
              },
            },
            { status: 400 },
          );
        if (q.startsWith("SELECT segments.date,")) {
          const [, from, to] = q.match(/BETWEEN '([^']+)' AND '([^']+)'/) || [];
          return Response.json({
            results: reportDates(from, to).map((date) => ({
              segments: { date, conversionActionCategory: "PURCHASE" },
              campaign: { id: "1" },
              metrics: {
                costMicros:
                  from === dateInZone("America/Los_Angeles", -3)
                    ? "105000000"
                    : "15000000",
                costPerConversion: "30000000",
                conversions:
                  from === dateInZone("America/Los_Angeles", -3) ? 3.5 : 0.5,
              },
            })),
          });
        }
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
        if (q.includes("policy_summary")) return Response.json({ results: [] });
        return Response.json({
          results: [
            {
              campaign: {
                id: "1",
                name: "Fixture shopping",
                status: "ENABLED",
                startDateTime: "2026-01-01 00:00:00",
              },
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
                    rows: body.variables?.query?.includes("TIMESERIES")
                      ? (() => {
                          const [, from, to] = body.variables.query.match(
                            /SINCE (\S+) UNTIL (\S+)/,
                          );
                          return reportDates(from, to).map((day) => ({
                            day,
                            total_sales: "100",
                            orders: "2",
                          }));
                        })()
                      : [{ total_sales: "8765.43", orders: "9" }],
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
      assert.equal(
        adsCalls,
        11,
        "four recent Ads days and campaign pause history are fetched in eleven queries",
      );
      assert.equal(first.errors, 0);
      const rows =
        await sql`SELECT source,report_date::text,payload,error FROM reports WHERE store_id=${id}`;
      assert.equal(rows.length, 8);
      const observations =
        await sql`SELECT source,report_date::text,observed_at,timezone,payload FROM report_observations WHERE store_id=${id}`;
      assert.equal(
        observations.length,
        2,
        "only source-local current dates become intraday observations",
      );
      assert.ok(
        observations.every((row) => !Object.hasOwn(row.payload, "raw")),
      );
      assert.ok(
        observations.every(
          (row) =>
            row.report_date ===
            dateInZone(row.timezone, 0, new Date(row.observed_at)),
        ),
      );
      await sql`UPDATE reports SET payload=payload WHERE store_id=${id}`;
      assert.equal(
        (
          await sql`SELECT count(*) FROM report_observations WHERE store_id=${id}`
        )[0].count,
        "2",
        "same fetchedAt never duplicates an observation",
      );
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
      const rangeStart = "2026-09-10",
        rangeEnd = "2026-09-17";
      const ranged = await syncReports(rangeStart, rangeEnd);
      assert.equal(ranged.synced, 2);
      assert.equal(ranged.errors, 0);
      const rangeRows =
        await sql`SELECT source,start_date::text,end_date::text,payload,error FROM report_ranges WHERE store_id=${id} AND start_date=${rangeStart}::date AND end_date=${rangeEnd}::date`;
      assert.equal(rangeRows.length, 2);
      assert.ok(rangeRows.every((row) => row.start_date === rangeStart));
      assert.ok(rangeRows.every((row) => row.end_date === rangeEnd));
      assert.ok(
        rangeRows.every((row) => row.payload.date.includes(rangeStart)),
      );
      assert.ok(rangeRows.every((row) => row.payload.date.includes(rangeEnd)));
      const callsBefore = providerCalls;
      const reused = await syncReports(rangeStart, rangeEnd, true);
      assert.equal(reused.synced, 0);
      assert.equal(
        providerCalls,
        callsBefore,
        "saved ranges require no provider calls",
      );
      // Deleting an exact range must still reuse the persisted daily breakdown.
      await sql`DELETE FROM report_ranges WHERE store_id=${id} AND source='shop' AND start_date=${rangeStart}::date`;
      const dailyReuse = await syncReports(rangeStart, rangeEnd, true);
      assert.equal(dailyReuse.synced, 0);
      assert.equal(providerCalls, callsBefore);
      const subset = await savedReports("2026-09-12", "2026-09-17");
      assert.equal(subset.length, 2);
      assert.equal(subset.find((r) => r.source === "ads")!.payload.spend, 90);
      assert.equal(
        subset.find((r) => r.source === "ads")!.payload.purchases,
        3,
      );
      assert.equal(subset.find((r) => r.source === "shop")!.payload.orders, 12);
      assert.equal(
        (await syncReports("2026-09-12", "2026-09-17", true)).synced,
        0,
      );
      assert.equal(
        providerCalls,
        callsBefore,
        "subset reads and sync need no provider requests",
      );
      // A gap fetches only its missing source/day, preserving all saved dates.
      await sql`DELETE FROM reports WHERE store_id=${id} AND source='shop' AND report_date='2026-09-14'`;
      const partial = await syncReports(rangeStart, rangeEnd, true);
      assert.equal(partial.synced, 1, "only the missing source/day is fetched");
      assert.equal(
        providerCalls - callsBefore,
        2,
        "one shop day needs only metadata and sales requests",
      );
      // Manual sync must overwrite every already-saved day, clear old errors,
      // and replace the view of any older overlapping exact-range snapshot.
      for (const source of ["ads", "shop"]) {
        const old =
          source === "ads"
            ? { ...ads!.payload, spend: 999 }
            : { ...shop!.payload, orders: 999 };
        await sql`INSERT INTO reports(store_id,source,report_date,payload,error,checked_at)
          SELECT ${id}::uuid,${source},day::date,${sql.json(old)},'Old failure','2020-01-01'
          FROM generate_series('2026-08-01'::date,'2026-08-30'::date,'1 day') AS day`;
        await sql`INSERT INTO report_ranges(store_id,source,start_date,end_date,payload,checked_at)
          VALUES(${id},${source},'2026-08-24','2026-08-30',${sql.json(old)},'2020-01-01')`;
      }
      const month = await syncReports("2026-08-01", "2026-08-30");
      const refreshedDays =
        await sql`SELECT source,report_date::text,payload,error,checked_at FROM reports WHERE store_id=${id} AND report_date BETWEEN '2026-08-01' AND '2026-08-30'`;
      assert.equal(
        refreshedDays.length,
        60,
        "manual refresh updates existing dates without duplicates",
      );
      for (const day of refreshedDays) {
        assert.equal(day.payload.date, day.report_date);
        assert.equal(day.error, null);
        assert.ok(new Date(day.checked_at) > new Date("2020-01-01"));
        if (day.source === "ads") assert.equal(day.payload.spend, 15);
        else assert.equal(day.payload.orders, 2);
      }
      assert.equal(month.errors, 0);
      const afterMonth = providerCalls;
      assert.equal(
        (await syncReports("2026-08-24", "2026-08-30", true)).synced,
        0,
      );
      assert.equal(
        providerCalls,
        afterMonth,
        "30-day sync followed by 7-day view never calls providers",
      );
      assert.equal(
        (await savedReports("2026-08-24", "2026-08-30")).find(
          (r) => r.source === "ads",
        )!.payload.spend,
        105,
      );
      const snapshot = {
        products: [],
        campaigns: [],
        performance: [],
        campaignDaily: [],
        links: [],
        date: rangeStart,
        currency: "INR",
        timezone: "Asia/Kolkata",
        catalogError: null,
        adsError: null,
        fetchedAt: "2020-01-01T00:00:00Z",
      };
      await sql`INSERT INTO store_product_snapshots(store_id,start_date,end_date,payload,checked_at) VALUES(${id},${rangeStart},${rangeEnd},${sql.json(snapshot)},'2020-01-01')`;
      const [savedStore] = await sql`SELECT * FROM stores WHERE id=${id}`;
      const productCalls = providerCalls;
      const cachedProducts = await storeProducts(
        savedStore,
        rangeStart,
        rangeEnd,
        "INR",
        "Asia/Kolkata",
      );
      assert.equal(cachedProducts.fetchedAt, snapshot.fetchedAt);
      assert.equal(
        providerCalls,
        productCalls,
        "old product snapshots remain reusable",
      );
      // More concurrent product reads than pool connections must never deadlock.
      await Promise.all(
        Array.from({ length: 8 }, () =>
          storeProducts(
            savedStore,
            rangeStart,
            rangeEnd,
            "INR",
            "Asia/Kolkata",
          ),
        ),
      );
      const extraStores = [];
      for (let index = 0; index < 7; index++) {
        const extraId = randomUUID();
        await sql`INSERT INTO stores(id,name,domain,cid,group_id) VALUES(${extraId},${`Export fixture ${index}`},${`export-fixture-${index}.myshopify.com`},${`111111111${index}`},3)`;
        await sql`INSERT INTO report_ranges(store_id,source,start_date,end_date,payload) VALUES(${extraId},'ads',${rangeStart},${rangeEnd},${sql.json({ ...ads!.payload, date: `${rangeStart} – ${rangeEnd}` })})`;
        await sql`INSERT INTO store_product_snapshots(store_id,start_date,end_date,payload) VALUES(${extraId},${rangeStart},${rangeEnd},${sql.json(snapshot)})`;
        extraStores.push(extraId);
      }
      const [generated, responsive] = await Promise.all([
        buildExport(rangeStart, rangeEnd),
        sql`SELECT count(*) FROM stores`,
      ]);
      assert.equal(generated.status, 200);
      assert.equal(Number(responsive[0].count), 8);
      assert.ok((await generated.text()).includes("Export fixture 6"));
      const [queuedJob] =
        await sql`INSERT INTO export_jobs(start_date,end_date,filename) VALUES(${rangeStart},${rangeEnd},'background.csv') RETURNING id`;
      await processExportJobs();
      const [readyJob] =
        await sql`SELECT status,csv FROM export_jobs WHERE id=${queuedJob.id}`;
      assert.equal(readyJob.status, "ready");
      assert.ok(readyJob.csv.includes("Export fixture 6"));
      // An interrupted worker's persisted job is recoverable.
      await sql`UPDATE export_jobs SET status='processing',csv=NULL WHERE id=${queuedJob.id}`;
      await processExportJobs();
      assert.equal(
        (await sql`SELECT status FROM export_jobs WHERE id=${queuedJob.id}`)[0]
          .status,
        "ready",
      );
      for (const extraId of extraStores)
        await sql`DELETE FROM stores WHERE id=${extraId}`;
      const lock = await sql.reserve();
      await lock`SELECT pg_advisory_lock(734052)`;
      let held = true;
      try {
        assert.equal((await syncReports()).busy, true);
        let settled = false;
        const scheduled = syncReports(rangeStart, rangeEnd, true, true).finally(
          () => {
            settled = true;
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
          settled,
          false,
          "scheduled jobs wait while another sync holds the lock",
        );
        await lock`SELECT pg_advisory_unlock(734052)`;
        held = false;
        assert.equal(
          (await scheduled).busy,
          false,
          "scheduled jobs continue after the active sync finishes",
        );
      } finally {
        if (held) await lock`SELECT pg_advisory_unlock(734052)`;
        lock.release();
      }
      failAds = true;
      const second = await syncReports();
      assert.equal(second.errors, 4);
      assert.equal(second.synced, 4);
      const [preserved] =
        await sql`SELECT payload,error,checked_at FROM reports WHERE store_id=${id} AND source='ads' AND report_date=${dateInZone("America/Los_Angeles")}`;
      assert.equal(preserved.payload.spend, 105);
      assert.ok(preserved.error);
      const status = JSON.parse((await getSetting("sync_status"))!);
      assert.equal(status.running, false);
      assert.equal(status.errors, 4);
      assert.ok(status.finishedAt);
      // Reaching the shared background threshold cannot contact Google or
      // replace saved Ads metrics with empty/zero data; Shopify keeps syncing.
      failAds = false;
      await sql`TRUNCATE google_ads_operations`;
      const scope = googleQuotaScope("qa-client");
      await sql`INSERT INTO google_ads_operations(scope,operations,background) SELECT ${scope},1,true FROM generate_series(1,2304)`;
      const beforePause = adsCalls;
      const paused = await syncReports(
        undefined,
        undefined,
        false,
        false,
        true,
      );
      assert.equal(paused.errors, 0);
      assert.equal(paused.deferred, 4);
      assert.equal(
        paused.synced,
        4,
        "Shopify still updates during an Ads quota pause",
      );
      assert.equal(paused.adsPause?.reason, "background");
      assert.ok(paused.adsPause?.resumeAt);
      assert.equal(
        adsCalls,
        beforePause,
        "background quota stops requests before they reach Google",
      );
      const [pausedSnapshot] =
        await sql`SELECT payload,error,checked_at FROM reports WHERE store_id=${id} AND source='ads' AND report_date=${dateInZone("America/Los_Angeles")}`;
      assert.equal(pausedSnapshot.payload.spend, 105);
      assert.equal(
        pausedSnapshot.error,
        preserved.error,
        "a quota pause preserves genuine provider errors instead of overwriting them",
      );
      assert.equal(
        pausedSnapshot.checked_at.getTime(),
        preserved.checked_at.getTime(),
        "skipping a provider must not make its snapshot look fresher",
      );
      const pausedStatus = JSON.parse((await getSetting("sync_status"))!);
      assert.equal(pausedStatus.deferred, 4);
      assert.equal(pausedStatus.errors, 0);
      assert.equal(pausedStatus.running, false);
      const manual = await syncReports();
      assert.equal(
        manual.errors,
        0,
        "manual sync can use the reserved allowance",
      );
      assert.equal(adsCalls - beforePause, 11);
      const quotaMessage =
        "Google API background sync paused at 80% of the rolling daily budget. Saved reports remain available; manual refreshes can use the reserved allowance.";
      const reportDay = dateInZone("America/Los_Angeles");
      await sql`UPDATE reports SET error=${quotaMessage} WHERE store_id=${id} AND source='ads' AND report_date=${reportDay}`;
      await sql`UPDATE reports SET error='Genuine Shopify error' WHERE store_id=${id} AND source='shop' AND report_date=${dateInZone("Asia/Kolkata")}`;
      const [beforeCleanup] =
        await sql`SELECT payload,checked_at FROM reports WHERE store_id=${id} AND source='ads' AND report_date=${reportDay}`;
      await sql.unsafe(
        await readFile(
          new URL(
            "../../db/migrations/011_quota_pause_status.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const [cleaned] =
        await sql`SELECT payload,error,checked_at FROM reports WHERE store_id=${id} AND source='ads' AND report_date=${reportDay}`;
      assert.equal(cleaned.error, null);
      assert.deepEqual(cleaned.payload, beforeCleanup.payload);
      assert.equal(
        cleaned.checked_at.getTime(),
        beforeCleanup.checked_at.getTime(),
      );
      assert.equal(
        (
          await sql`SELECT error FROM reports WHERE store_id=${id} AND source='shop' AND report_date=${dateInZone("Asia/Kolkata")}`
        )[0].error,
        "Genuine Shopify error",
      );
      const [cipher] =
        await sql`SELECT token_cipher FROM google_connections WHERE group_id=3`;
      assert.ok(!cipher.token_cipher.includes("qa-refresh"));
    } finally {
      globalThis.fetch = original;
      await sql`TRUNCATE report_observations,export_jobs,product_campaign_links,store_product_snapshots,report_ranges,reports,stores,google_connections,settings,oauth_states,auth_attempts`;
      await sql`TRUNCATE google_ads_operations,google_ads_quota_state`;
      await sql.end();
    }
  },
);
