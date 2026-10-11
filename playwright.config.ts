import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
const local = JSON.parse(readFileSync(".local/config.json", "utf8"));
const connection = `postgresql://storedesk:${local.DB_PASSWORD}@127.0.0.1:55432/`;
const sql = postgres(connection + "storedesk");
const existing =
  await sql`SELECT datname FROM pg_database WHERE datname='storedesk_browser_test'`;
if (!existing.length)
  await sql.unsafe("CREATE DATABASE storedesk_browser_test");
await sql.end();
const databaseUrl = connection + "storedesk_browser_test";
process.env.TEST_DATABASE_URL = databaseUrl;
process.env.ENCRYPTION_KEY = local.ENCRYPTION_KEY;
const testDb = postgres(databaseUrl);
await testDb.unsafe(readFileSync("db/migrations/001_initial.sql", "utf8"));
await testDb.unsafe(
  readFileSync("db/migrations/002_dynamic_google.sql", "utf8"),
);
await testDb.unsafe(
  readFileSync("db/migrations/003_store_products.sql", "utf8"),
);
await testDb.unsafe(readFileSync("db/migrations/004_date_ranges.sql", "utf8"));
await testDb.unsafe(readFileSync("db/migrations/005_export_jobs.sql", "utf8"));
await testDb`TRUNCATE export_jobs, product_campaign_links,store_product_snapshots,report_ranges,reports,stores,google_connections,settings,oauth_states,auth_attempts`;
await testDb.end();
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      STOREDESK_BROWSER_TEST: "true",
      DATABASE_URL: databaseUrl,
      APP_URL: "http://127.0.0.1:3100",
      LOCAL_DEV_AUTH: "false",
      SESSION_SECRET: local.SESSION_SECRET,
      ENCRYPTION_KEY: local.ENCRYPTION_KEY,
      SETUP_TOKEN: local.SETUP_TOKEN,
    },
  },
  outputDir: "test-results",
});
