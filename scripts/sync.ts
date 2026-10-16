import { processExportJobs } from "../lib/server/export-jobs";
import { syncReports } from "../lib/server/sync";
import { db, getSetting } from "../lib/server/db";
import { last30ReportRange, refreshIntervalMinutes } from "../lib/schedule";
try {
  const daily = process.argv.includes("--last30");
  const hourly = process.argv.includes("--hourly");
  if (daily && hourly) throw new Error("Choose one scheduled sync mode.");
  await processExportJobs();
  const interval = refreshIntervalMinutes();
  const previous = JSON.parse((await getSetting("sync_status")) || "null");
  const elapsed = previous?.finishedAt
    ? Date.now() - Date.parse(previous.finishedAt)
    : Infinity;
  if (daily) {
    const { from, to } = last30ReportRange();
    const result = await syncReports(from, to, false, true);
    console.log(JSON.stringify({ mode: "daily-last30", from, to, ...result }));
    if (result.errors) process.exitCode = 1;
  } else if (hourly) {
    // Railway owns the hourly cadence; a manual or daily refresh must not skip it.
    const result = await syncReports(undefined, undefined, false, true);
    console.log(JSON.stringify({ mode: "hourly", ...result }));
    if (result.errors) process.exitCode = 1;
  } else if (
    process.env.SYNC_SCHEDULED === "true" &&
    elapsed < interval * 60000
  ) {
    console.log(
      JSON.stringify({ skipped: true, refreshIntervalMinutes: interval }),
    );
  } else
    console.log(
      JSON.stringify(
        await syncReports(
          undefined,
          undefined,
          false,
          false,
          process.env.SYNC_SCHEDULED === "true",
        ),
      ),
    );
} catch {
  console.error(
    "Report sync failed. Check service configuration and database connectivity.",
  );
  process.exitCode = 1;
} finally {
  await db().end();
}
