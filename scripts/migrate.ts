import { readFile } from "node:fs/promises";
import { db } from "../lib/server/db";
const sql = db();
try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`;
  await sql.begin(async (tx) => {
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
  });
  console.log("Database migrations complete.");
} finally {
  await sql.end();
}
