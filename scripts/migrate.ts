import { readFile } from "node:fs/promises";
import { db } from "../lib/server/db";
// Only an explicit, approved allowance changes the shared policy. Existing
// installations otherwise retain their configured limit and request ledger.
const configuredLimit = process.env.GOOGLE_ADS_DAILY_LIMIT;
const dailyLimit =
  configuredLimit === undefined ? null : Number(configuredLimit);
if (
  configuredLimit !== undefined &&
  (!/^[1-9]\d*$/.test(configuredLimit) ||
    !Number.isSafeInteger(dailyLimit) ||
    dailyLimit! > 2147483647)
)
  throw new Error(
    "GOOGLE_ADS_DAILY_LIMIT must be a positive PostgreSQL integer.",
  );
const sql = db();
try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`;
  const policy = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(734051)`;
    for (const name of [
      "001_initial",
      "002_dynamic_google",
      "003_store_products",
      "004_date_ranges",
      "005_export_jobs",
      "006_mcp_oauth",
      "007_google_ads_quota",
      "008_report_observations",
      "009_budget_history",
      "010_campaign_activity",
      "011_quota_pause_status",
    ]) {
      const existing =
        await tx`SELECT name FROM schema_migrations WHERE name=${name}`;
      if (!existing.length) {
        await tx.unsafe(
          await readFile(
            new URL(`../db/migrations/${name}.sql`, import.meta.url),
            "utf8",
          ),
        );
        await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
      }
    }
    if (dailyLimit !== null)
      await tx`UPDATE google_ads_quota_policy SET daily_limit=${dailyLimit} WHERE singleton=TRUE`;
    const [quota] =
      await tx`SELECT daily_limit,spacing_ms FROM google_ads_quota_policy WHERE singleton=TRUE`;
    return quota;
  });
  console.log("Database migrations complete.");
  console.log(
    `Google Ads shared quota: ${policy.daily_limit} operations per rolling 24 hours; warning at ${Math.ceil(policy.daily_limit * 0.7)}, background pause at ${Math.ceil(policy.daily_limit * 0.8)}, spacing ${policy.spacing_ms} ms. Existing usage and cooldowns retained.`,
  );
} finally {
  await sql.end();
}
