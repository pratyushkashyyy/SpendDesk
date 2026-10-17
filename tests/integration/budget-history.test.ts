import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { encrypt } from "../../lib/server/crypto";
import { db } from "../../lib/server/db";
import { refreshBudgetHistory } from "../../lib/server/budget-history";
import {
  googleQuotaScope,
  reserveGoogleRequest,
} from "../../lib/server/google-quota";
const url = new URL(process.env.DATABASE_URL || "");
if (url.hostname !== "127.0.0.1" || url.port !== "55432")
  throw Error("Isolated local database required.");
const admin = postgres(url.toString());
if (
  !(
    await admin`SELECT datname FROM pg_database WHERE datname='storedesk_budget_test'`
  ).length
)
  await admin.unsafe("CREATE DATABASE storedesk_budget_test");
await admin.end();
url.pathname = "/storedesk_budget_test";
process.env.DATABASE_URL = url.toString();
const sql = postgres(url.toString(), { onnotice: () => {} });
for (const name of [
  "001_initial",
  "002_dynamic_google",
  "004_date_ranges",
  "007_google_ads_quota",
  "009_budget_history",
  "010_campaign_activity",
])
  await sql.unsafe(readFileSync(`db/migrations/${name}.sql`, "utf8"));
await sql`TRUNCATE reports,report_ranges,google_budget_events,budget_observed_changes,budget_states,stores CASCADE`;
test("budget triggers capture real configuration changes across report dates and ranges, without duplicate or stale changes", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const id = randomUUID();
    await sql`INSERT INTO stores(id,name,domain,cid,group_id)VALUES(${id},'Budget QA','budget.myshopify.com','123',1)`;
    const base = Date.now() - 3600000;
    const data = (at: number, a: number, b = 20) => ({
      date: "2026-10-01",
      fetchedAt: new Date(at).toISOString(),
      currency: "USD",
      timezone: "Asia/Kolkata",
      budgets: [
        {
          id: "1",
          name: "Shared",
          period: "DAILY",
          amount: a,
          shared: true,
          campaigns: ["A", "B"],
        },
        {
          id: "2",
          name: "Other",
          period: "DAILY",
          amount: b,
          shared: false,
          campaigns: ["C"],
        },
      ],
    });
    await sql`INSERT INTO reports(store_id,source,report_date,payload)VALUES(${id},'ads','2026-10-01',${sql.json(data(base, 100))})`;
    await sql`INSERT INTO reports(store_id,source,report_date,payload)VALUES(${id},'ads','2026-10-02',${sql.json(data(base, 100))})`;
    assert.equal((await sql`SELECT * FROM budget_observed_changes`).length, 0);
    await sql`INSERT INTO report_ranges(store_id,source,start_date,end_date,payload)VALUES(${id},'ads','2026-09-01','2026-09-30',${sql.json(data(base + 600000, 150))})`;
    const [change] = await sql`SELECT * FROM budget_observed_changes`;
    assert.equal(Number(change.previous_total), 120);
    assert.equal(Number(change.total), 170);
    assert.equal(new Date(change.previous_at).getTime(), base);
    await sql`UPDATE reports SET payload=${sql.json(data(base - 600000, 50))} WHERE store_id=${id}`;
    assert.equal(
      Number(
        (await sql`SELECT total FROM budget_states WHERE store_id=${id}`)[0]
          .total,
      ),
      170,
    );
    await sql`UPDATE reports SET payload=${sql.json(data(base + 1200000, 150))} WHERE store_id=${id}`;
    assert.equal((await sql`SELECT * FROM budget_observed_changes`).length, 1);
    await sql`UPDATE reports SET error='Provider failed',payload=${sql.json(data(base + 1800000, 200))} WHERE store_id=${id}`;
    assert.equal((await sql`SELECT * FROM budget_observed_changes`).length, 1);
    const activity = {
      at: new Date(base + 1200000).toISOString(),
      from: "2026-09-17",
      timezone: "Asia/Kolkata",
      complete: true,
      campaigns: [],
      budgets: [],
      events: [],
    };
    await sql`UPDATE report_ranges SET payload=${sql.json({ ...data(base + 1200000, 150), raw: { campaignActivity: activity } })} WHERE store_id=${id}`;
    assert.equal(
      (
        await sql`SELECT campaign_activity FROM budget_states WHERE store_id=${id}`
      )[0].campaign_activity.at,
      activity.at,
    );
    await sql`UPDATE report_ranges SET payload=${sql.json({ ...data(base + 1200000, 150), raw: { campaignActivity: { ...activity, at: new Date(base + 600000).toISOString() } } })} WHERE store_id=${id}`;
    assert.equal(
      (
        await sql`SELECT campaign_activity FROM budget_states WHERE store_id=${id}`
      )[0].campaign_activity.at,
      activity.at,
      "out-of-order historical reports cannot replace a newer status timeline",
    );
    await sql`UPDATE report_ranges SET payload=${sql.json({ ...data(base + 1200000, 150), raw: { campaignActivity: { ...activity, complete: false, at: new Date().toISOString() } } })} WHERE store_id=${id}`;
    assert.equal(
      (
        await sql`SELECT campaign_activity FROM budget_states WHERE store_id=${id}`
      )[0].campaign_activity.complete,
      true,
      "failed enrichment keeps genuine saved history",
    );
    // Budget imports share the exact project governor and cache across processes.
    await sql`TRUNCATE google_ads_operations,google_ads_quota_state`;
    await sql`UPDATE google_ads_quota_policy SET daily_limit=10,spacing_ms=0`;
    await sql`INSERT INTO settings(key,value)VALUES('google_config',${encrypt({ clientId: "budget-test", clientSecret: "fixture", developerToken: "fixture" })}) ON CONFLICT(key)DO UPDATE SET value=EXCLUDED.value`;
    await sql`INSERT INTO google_connections(group_id,email,token_cipher)VALUES(1,'budget@example.test',${encrypt({ refreshToken: "fixture" })}) ON CONFLICT(group_id)DO UPDATE SET token_cipher=EXCLUDED.token_cipher`;
    let adsCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token"))
        return Response.json({ access_token: "fixture" });
      if (url.includes("googleads.googleapis.com/")) {
        adsCalls++;
        const query = JSON.parse(String(init?.body)).query;
        if (query.includes("FROM campaign"))
          return Response.json({
            results: [
              {
                campaign: {
                  id: "1",
                  name: "Active",
                  status: "ENABLED",
                  startDateTime: "2026-01-01 00:00:00",
                },
                campaignBudget: {
                  id: "1",
                  name: "Shared",
                  period: "DAILY",
                  amountMicros: "150000000",
                  explicitlyShared: true,
                },
              },
              {
                campaign: {
                  id: "2",
                  name: "Paused",
                  status: "PAUSED",
                  startDateTime: "2026-01-01 00:00:00",
                },
                campaignBudget: {
                  id: "2",
                  name: "Other",
                  period: "DAILY",
                  amountMicros: "20000000",
                },
              },
            ],
          });
        assert.match(query, /FROM change_event/);
        assert.match(query, /LIMIT 10000/);
        const changedAt = base + 300000;
        return Response.json({
          results: [
            {
              changeEvent: {
                resourceName: `customers/123/changeEvents/${BigInt(changedAt) * BigInt(1000)}~0~0`,
                changeResourceName: "customers/123/campaignBudgets/1",
                resourceChangeOperation: "UPDATE",
                changedFields: "amountMicros",
                oldResource: { campaignBudget: { amountMicros: "100000000" } },
                newResource: { campaignBudget: { amountMicros: "150000000" } },
              },
            },
          ],
        });
      }
      throw Error("Unexpected external request in isolated budget test.");
    };
    await sql`UPDATE budget_states SET history_next_at=now() WHERE store_id=${id}`;
    await refreshBudgetHistory();
    assert.equal(adsCalls, 2);
    const [activityState] =
      await sql`SELECT campaign_activity FROM budget_states WHERE store_id=${id}`;
    assert.equal(activityState.campaign_activity.complete, true);
    assert.equal(activityState.campaign_activity.campaigns[1].status, "PAUSED");
    assert.equal(
      Number(
        (
          await sql`SELECT previous_amount FROM google_budget_events WHERE store_id=${id}`
        )[0].previous_amount,
      ),
      100,
    );
    await refreshBudgetHistory();
    assert.equal(adsCalls, 2, "daily cache avoids repeated calls");
    const scope = googleQuotaScope("budget-test");
    for (let i = 0; i < 6; i++)
      await reserveGoogleRequest({ scope, sql: sql as any });
    await refreshBudgetHistory({ storeId: id });
    assert.equal(adsCalls, 2, "background requests stop at 80%");
    assert.match(
      (
        await sql`SELECT history_error FROM budget_states WHERE store_id=${id}`
      )[0].history_error,
      /80%/,
    );
    await refreshBudgetHistory({ storeId: id, background: false });
    assert.equal(adsCalls, 4, "manual refresh can use reserved allowance");
    assert.equal(
      (
        await sql`SELECT history_error FROM budget_states WHERE store_id=${id}`
      )[0].history_error,
      null,
    );
    assert.equal(
      (await sql`SELECT * FROM google_budget_events WHERE store_id=${id}`)
        .length,
      1,
      "repeated imports do not duplicate edits",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await sql.end();
    await db().end();
  }
});
