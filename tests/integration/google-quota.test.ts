import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";
import { db } from "../../lib/server/db";
import {
  GoogleQuotaPause,
  reserveGoogleRequest,
  googleQuotaStatus,
  pauseGoogleRequests,
  requestGoogleAds,
} from "../../lib/server/google-quota";

const url = new URL(process.env.DATABASE_URL || "");
if (url.hostname !== "127.0.0.1" || url.port !== "55432")
  throw new Error("Quota integration tests require isolated local PostgreSQL.");
const admin = postgres(url.toString());
if (
  !(
    await admin`SELECT datname FROM pg_database WHERE datname='storedesk_quota_test'`
  ).length
)
  await admin.unsafe("CREATE DATABASE storedesk_quota_test");
await admin.end();
url.pathname = "/storedesk_quota_test";
process.env.DATABASE_URL = url.toString();
const sql = db();
await sql.unsafe(
  await readFile(
    new URL("../../db/migrations/007_google_ads_quota.sql", import.meta.url),
    "utf8",
  ),
);
await sql`TRUNCATE google_ads_operations,google_ads_quota_state`;
await sql`UPDATE google_ads_quota_policy SET daily_limit=2880,spacing_ms=1000`;

test(
  "independent worker processes share pacing, rolling budgets, cooldowns and exhaustion",
  { timeout: 15000 },
  async () => {
    const scope = "shared-project";
    try {
      const script = `import { reserveGoogleRequest } from './lib/server/google-quota.ts'; import { db } from './lib/server/db.ts'; console.log(JSON.stringify(await reserveGoogleRequest({ scope: 'shared-project', background: true }))); await db().end();`;
      const results = await Promise.all(
        Array.from({ length: 2 }, () =>
          promisify(execFile)(
            process.execPath,
            ["--import", "tsx", "--input-type=module", "-e", script],
            { env: process.env },
          ),
        ),
      );
      const reservations = results.map((r) => JSON.parse(r.stdout));
      assert.equal(
        reservations.filter((r) => r.reason === "allowed").length,
        1,
        "only one process may use the global request slot",
      );
      assert.equal(
        reservations.filter((r) => r.reason === "spacing").length,
        1,
      );
      assert.equal(
        (await googleQuotaStatus(scope)).used,
        1,
        "waiting for a slot must not consume quota",
      );

      await sql`UPDATE google_ads_quota_policy SET spacing_ms=0`;
      await sql`UPDATE google_ads_quota_state SET next_request_at='-infinity'`;
      await sql`TRUNCATE google_ads_operations`;
      await sql`INSERT INTO google_ads_operations(scope,operations,background) SELECT ${scope},1,true FROM generate_series(1,2016)`;
      assert.equal(
        (await googleQuotaStatus(scope)).warning,
        true,
        "warning starts at exactly 70%",
      );
      assert.equal((await googleQuotaStatus(scope)).backgroundPaused, false);
      await sql`INSERT INTO google_ads_operations(scope,operations,background) SELECT ${scope},1,true FROM generate_series(1,287)`;
      const concurrent = await Promise.all(
        Array.from({ length: 8 }, () =>
          reserveGoogleRequest({ scope, background: true }),
        ),
      );
      assert.equal(
        concurrent.filter((r) => r.reason === "allowed").length,
        1,
        "concurrent callers cannot overshoot the 80% threshold",
      );
      assert.equal(
        concurrent.filter((r) => r.reason === "background").length,
        7,
      );
      let status = await googleQuotaStatus(scope);
      assert.equal(status.used, 2304);
      assert.equal(status.backgroundPaused, true);
      assert.equal(
        (await reserveGoogleRequest({ scope, background: false })).reason,
        "allowed",
        "manual work retains the final 20%",
      );
      await sql`INSERT INTO google_ads_operations(scope,operations,background) SELECT ${scope},1,false FROM generate_series(1,574)`;
      const pageRequest = { body: JSON.stringify({ pageToken: "fixture" }) };
      await requestGoogleAds(
        "https://fixture",
        pageRequest,
        { scope, background: false },
        {
          fetch: async () => Response.json({ results: [] }),
        },
      );
      assert.equal(
        (await googleQuotaStatus(scope)).used,
        2879,
        "successful pagination refunds its provisional operation",
      );
      await assert.rejects(
        requestGoogleAds(
          "https://fixture",
          pageRequest,
          { scope, background: false },
          {
            fetch: async () => Response.json({ error: {} }, { status: 400 }),
          },
        ),
      );
      assert.equal(
        (await reserveGoogleRequest({ scope, background: false })).reason,
        "exhausted",
      );
      status = await googleQuotaStatus(scope);
      assert.equal(status.used, 2880);
      assert.equal(status.exhausted, true);

      await sql`UPDATE google_ads_operations SET requested_at=clock_timestamp()-INTERVAL '25 hours'`;
      assert.equal(
        (await reserveGoogleRequest({ scope, background: true })).reason,
        "allowed",
        "rolling quota resumes when old operations expire",
      );
      assert.equal((await googleQuotaStatus(scope)).used, 1);
      await pauseGoogleRequests({ scope }, 60000);
      assert.equal(
        (await reserveGoogleRequest({ scope, background: false })).reason,
        "cooldown",
        "all processes observe the same cooldown",
      );
      await pauseGoogleRequests({ scope }, 86400000, true);
      assert.equal(
        (await reserveGoogleRequest({ scope, background: false })).reason,
        "exhausted",
      );
      assert.equal((await googleQuotaStatus(scope)).exhausted, true);

      const connection = await sql.reserve();
      try {
        await assert.rejects(
          requestGoogleAds(
            "https://must-not-be-called",
            { body: JSON.stringify({ query: "fixture" }) },
            { scope, sql: connection },
            {
              fetch: async () => {
                assert.fail(
                  "persisted daily exhaustion must prevent HTTP requests",
                );
              },
            },
          ),
          GoogleQuotaPause,
        );
      } finally {
        connection.release();
      }
    } finally {
      await sql`TRUNCATE google_ads_operations,google_ads_quota_state`;
      await sql.end();
    }
  },
);
