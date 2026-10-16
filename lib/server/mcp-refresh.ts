import { randomUUID } from "node:crypto";
import { db, getSetting, putSetting } from "./db";
import { syncReports } from "./sync";
export type ScheduleRefresh = (work: () => Promise<void>) => void;
type RefreshStatus = {
  requestId: string;
  state: "queued" | "running" | "completed" | "paused" | "busy" | "failed";
  requestedAt: string;
  finishedAt?: string;
  from?: string;
  to?: string;
  synced?: number;
  errors?: number;
  deferred?: number;
  message?: string;
};
export async function getRefreshStatus() {
  const status: RefreshStatus | null = JSON.parse(
    (await getSetting("mcp_refresh_status")) || "null",
  );
  if (status && ["queued", "running"].includes(status.state)) {
    const [lock] =
      await db()`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=0 AND objid=734052 AND granted) AS running`;
    if (!lock.running && Date.now() - Date.parse(status.requestedAt) > 300000)
      return {
        ...status,
        state: "failed" as const,
        message: "Refresh was interrupted. Request it again.",
      };
  }
  return status;
}
export async function requestRefresh(
  from: string | undefined,
  to: string | undefined,
  schedule: ScheduleRefresh,
) {
  const status: RefreshStatus = {
    requestId: randomUUID(),
    state: "queued",
    requestedAt: new Date().toISOString(),
    from,
    to,
  };
  const accepted = await db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(734053)`;
    const [saved] =
      await tx`SELECT value FROM settings WHERE key='mcp_refresh_status'`;
    const previous: RefreshStatus | null = JSON.parse(saved?.value || "null");
    const [lock] =
      await tx`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=0 AND objid=734052 AND granted) AS running`;
    if (
      lock.running ||
      (previous &&
        ["queued", "running"].includes(previous.state) &&
        Date.now() - Date.parse(previous.requestedAt) < 300000)
    )
      return false;
    await tx`INSERT INTO settings(key,value) VALUES('mcp_refresh_status',${JSON.stringify(status)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    return true;
  });
  if (!accepted)
    return {
      accepted: false,
      busy: true,
      message:
        "A refresh is already queued or running. Check get_sync_status; this request did not start another refresh.",
    };
  try {
    schedule(async () => {
      try {
        status.state = "running";
        await putSetting("mcp_refresh_status", JSON.stringify(status));
        const outcome = await syncReports(from, to);
        status.state = outcome.busy
          ? "busy"
          : outcome.deferred
            ? "paused"
            : "completed";
        status.synced = outcome.synced;
        status.errors = outcome.errors;
        status.deferred = outcome.deferred;
        if (!outcome.busy && outcome.adsPause)
          status.message = outcome.adsPause.message;
        if (outcome.busy)
          status.message =
            "Another sync started first. This request did not refresh its range; retry after it finishes.";
      } catch {
        status.state = "failed";
        status.message =
          "Refresh failed. Check dashboard source errors and try again.";
      } finally {
        status.finishedAt = new Date().toISOString();
        await putSetting("mcp_refresh_status", JSON.stringify(status));
      }
    });
  } catch {
    status.state = "failed";
    status.message = "Refresh could not be scheduled.";
    await putSetting("mcp_refresh_status", JSON.stringify(status));
    throw new Error(status.message);
  }
  return {
    accepted: true,
    busy: false,
    ...status,
    message:
      "Refresh queued. Use get_sync_status to check this requestId before reading updated reports. Completion with errors means some source reports were not refreshed.",
  };
}
