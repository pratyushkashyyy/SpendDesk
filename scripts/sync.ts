import { syncReports } from "../lib/server/sync";
import { db, getSetting } from "../lib/server/db";
import { refreshIntervalMinutes } from "../lib/schedule";
try {
  const interval = refreshIntervalMinutes();
  const previous = JSON.parse((await getSetting("sync_status")) || "null");
  const elapsed = previous?.finishedAt
    ? Date.now() - Date.parse(previous.finishedAt)
    : Infinity;
  if (process.env.SYNC_SCHEDULED === "true" && elapsed < interval * 60000) {
    console.log(
      JSON.stringify({ skipped: true, refreshIntervalMinutes: interval }),
    );
  } else console.log(JSON.stringify(await syncReports()));
} catch {
  console.error(
    "Report sync failed. Check service configuration and database connectivity.",
  );
  process.exitCode = 1;
} finally {
  await db().end();
}
