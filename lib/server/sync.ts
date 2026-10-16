import { db, putSetting } from "./db";
import { googleAccess, fetchAds } from "./google";
import { fetchShop } from "./shopify";
import { savedReports } from "./report-cache";
import { reportDates } from "../report-ranges";
import { dateInZone } from "../reporting";
import { GoogleQuotaPause, googleQuotaScope } from "./google-quota";
export type SyncStatus = {
  running: boolean;
  startedAt: string;
  finishedAt?: string;
  synced: number;
  errors: number;
  deferred?: number;
  adsPause?: {
    reason: "background" | "exhausted" | "cooldown";
    message: string;
    resumeAt?: string;
  };
  date?: string;
  failed?: boolean;
};
export async function syncReports(
  customDate?: string,
  endDate?: string,
  missingOnly = false,
  waitForLock = false,
  background = missingOnly || waitForLock,
) {
  const connection = await db().reserve();
  let acquired = false;
  const status: SyncStatus = {
    running: true,
    startedAt: new Date().toISOString(),
    synced: 0,
    errors: 0,
    deferred: 0,
    date:
      customDate && endDate && customDate !== endDate
        ? `${customDate} – ${endDate}`
        : customDate,
  };
  try {
    if (waitForLock) {
      // Scheduled runs queue behind manual/other scheduled work instead of being lost.
      await connection`SELECT pg_advisory_lock(734052)`;
      acquired = true;
    } else {
      const [lock] =
        await connection`SELECT pg_try_advisory_lock(734052) AS acquired`;
      acquired = lock.acquired;
    }
    if (!acquired) return { busy: true, synced: 0, errors: 0 };
    await putSetting("sync_status", JSON.stringify(status), connection);
    const savedStores =
      await connection`SELECT * FROM stores ORDER BY group_id,name`;
    let stores = [...savedStores];
    const existing = new Set<string>();
    if (missingOnly && customDate) {
      const saved = await savedReports(
        customDate,
        endDate || customDate,
        connection,
      );
      for (const row of saved) existing.add(`${row.store_id}:${row.source}`);
      stores = stores.filter(
        (store) =>
          !existing.has(`${store.id}:ads`) ||
          (store.shop_cipher && !existing.has(`${store.id}:shop`)),
      );
    }
    const tokens = new Map<
      number,
      Awaited<ReturnType<typeof googleAccess>> | Error
    >();
    const pausedScopes = new Map<string, GoogleQuotaPause>();
    for (const group of new Set(
      stores
        .filter((s) => !missingOnly || !existing.has(`${s.id}:ads`))
        .map((s) => s.group_id as number),
    ))
      try {
        tokens.set(group, await googleAccess(group, connection, background));
      } catch (e) {
        tokens.set(group, e as Error);
      }
    for (const store of stores) {
      for (const source of ["ads", "shop"] as const) {
        if (
          missingOnly &&
          (existing.has(`${store.id}:${source}`) ||
            (source === "shop" && !store.shop_cipher))
        )
          continue;
        const previous =
          await connection`SELECT payload FROM reports WHERE store_id=${store.id} AND source=${source} AND payload IS NOT NULL ORDER BY checked_at DESC LIMIT 1`;
        const timezone = previous[0]?.payload?.timezone || "Asia/Kolkata";
        const periods: {
          offset: number;
          from?: string;
          to?: string;
          recentDays?: number;
        }[] = customDate
          ? [{ offset: 0, from: customDate, to: endDate }]
          : source === "ads"
            ? [{ offset: 0, recentDays: 4 }]
            : [-1, 0, -2, -3].map((offset) => ({ offset }));
        if (missingOnly && customDate && endDate && customDate !== endDate) {
          const savedDays =
            await connection`SELECT report_date::text FROM reports WHERE store_id=${store.id} AND source=${source} AND payload IS NOT NULL AND report_date BETWEEN ${customDate}::date AND ${endDate}::date`;
          const covered = new Set(savedDays.map((r) => r.report_date));
          periods.length = 0;
          let current: (typeof periods)[number] | undefined;
          for (const day of reportDates(customDate, endDate)) {
            if (covered.has(day)) {
              current = undefined;
              continue;
            }
            if (current) current.to = day;
            else {
              current = { offset: 0, from: day, to: day };
              periods.push(current);
            }
          }
        }
        for (const {
          offset,
          from: fetchFrom,
          to: fetchTo,
          recentDays,
        } of periods) {
          let reportDate = fetchFrom || dateInZone(timezone, offset);
          try {
            const token = tokens.get(store.group_id);
            if (source === "ads" && token instanceof Error) throw token;
            if (source === "ads" && token && !(token instanceof Error)) {
              const pause = pausedScopes.get(
                googleQuotaScope(token.config.clientId),
              );
              if (pause) throw pause;
            }
            const data =
              source === "ads"
                ? await fetchAds(
                    store as any,
                    token as Awaited<ReturnType<typeof googleAccess>>,
                    offset,
                    fetchFrom,
                    fetchTo,
                    { recentDays },
                  )
                : await fetchShop(store as any, offset, fetchFrom, fetchTo);
            reportDate = data.date;
            const dailyReports = (data.raw as any)?.dailyReports;
            if (dailyReports?.length) {
              const rangeFrom = dailyReports[0].date;
              const rangeTo = dailyReports[dailyReports.length - 1].date;
              // Save daily records and the exact provider total in one atomic statement.
              delete (data.raw as any).dailyReports;
              await connection`WITH daily_saved AS (
                INSERT INTO reports(store_id,source,report_date,payload,error)
                SELECT ${store.id}::uuid,${source},(day->>'date')::date,day,NULL
                FROM jsonb_array_elements(${connection.json(dailyReports)}) AS day
                ON CONFLICT(store_id,source,report_date) DO UPDATE SET payload=EXCLUDED.payload,error=NULL,checked_at=now()
                RETURNING store_id
              )
              INSERT INTO report_ranges(store_id,source,start_date,end_date,payload,error)
              VALUES(${store.id},${source},${rangeFrom},${rangeTo},${connection.json(data as any)},NULL)
              ON CONFLICT(store_id,source,start_date,end_date) DO UPDATE SET payload=EXCLUDED.payload,error=NULL,checked_at=now()`;
            } else if (fetchFrom && fetchTo && fetchFrom !== fetchTo)
              await connection`INSERT INTO report_ranges(store_id,source,start_date,end_date,payload,error) VALUES(${store.id},${source},${fetchFrom},${fetchTo},${connection.json(data as any)},NULL) ON CONFLICT(store_id,source,start_date,end_date) DO UPDATE SET payload=EXCLUDED.payload,error=NULL,checked_at=now()`;
            else
              await connection`INSERT INTO reports(store_id,source,report_date,payload,error) VALUES(${store.id},${source},${reportDate},${connection.json(data as any)},NULL) ON CONFLICT(store_id,source,report_date) DO UPDATE SET payload=EXCLUDED.payload,error=NULL,checked_at=now()`;
            status.synced += recentDays || 1;
          } catch (e) {
            if (source === "ads" && e instanceof GoogleQuotaPause) {
              // A quota stop is expected scheduling state. Keep saved payloads,
              // freshness and genuine source errors exactly as they were.
              status.deferred = (status.deferred || 0) + (recentDays || 1);
              status.adsPause = {
                reason: e.reason,
                message: e.message,
                resumeAt: e.resumeAt,
              };
              const token = tokens.get(store.group_id);
              if (token && !(token instanceof Error))
                pausedScopes.set(googleQuotaScope(token.config.clientId), e);
              await putSetting(
                "sync_status",
                JSON.stringify(status),
                connection,
              );
              continue;
            }
            const message =
              e instanceof Error ? e.message : "Sync failed. Try again.";
            if (recentDays) {
              const dates = Array.from({ length: recentDays }, (_, index) =>
                dateInZone(timezone, -index),
              );
              for (const day of dates)
                await connection`INSERT INTO reports(store_id,source,report_date,error) VALUES(${store.id},${source},${day},${message}) ON CONFLICT(store_id,source,report_date) DO UPDATE SET error=EXCLUDED.error,checked_at=now()`;
            } else if (fetchFrom && fetchTo && fetchFrom !== fetchTo)
              await connection`INSERT INTO report_ranges(store_id,source,start_date,end_date,error) VALUES(${store.id},${source},${fetchFrom},${fetchTo},${message}) ON CONFLICT(store_id,source,start_date,end_date) DO UPDATE SET error=EXCLUDED.error,checked_at=now()`;
            else
              await connection`INSERT INTO reports(store_id,source,report_date,error) VALUES(${store.id},${source},${reportDate},${message}) ON CONFLICT(store_id,source,report_date) DO UPDATE SET error=EXCLUDED.error,checked_at=now()`;
            status.errors += recentDays || 1;
          }
          await putSetting("sync_status", JSON.stringify(status), connection);
        }
      }
    }
    return {
      busy: false,
      synced: status.synced,
      errors: status.errors,
      deferred: status.deferred || 0,
      adsPause: status.adsPause,
    };
  } catch (error) {
    status.failed = true;
    throw error;
  } finally {
    try {
      if (acquired) {
        status.running = false;
        status.finishedAt = new Date().toISOString();
        await putSetting("sync_status", JSON.stringify(status), connection);
        await connection`SELECT pg_advisory_unlock(734052)`;
      }
    } finally {
      connection.release();
    }
  }
}
