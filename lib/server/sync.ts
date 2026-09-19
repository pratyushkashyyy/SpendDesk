import { db, putSetting } from "./db";
import { googleAccess, fetchAds } from "./google";
import { fetchShop } from "./shopify";
import { dateInZone } from "../reporting";
export type SyncStatus = {
  running: boolean;
  startedAt: string;
  finishedAt?: string;
  synced: number;
  errors: number;
  date?: string;
  failed?: boolean;
};
export async function syncReports(customDate?: string, endDate?: string) {
  const connection = await db().reserve();
  let acquired = false;
  const status: SyncStatus = {
    running: true,
    startedAt: new Date().toISOString(),
    synced: 0,
    errors: 0,
    date:
      customDate && endDate && customDate !== endDate
        ? `${customDate} – ${endDate}`
        : customDate,
  };
  try {
    const [lock] =
      await connection`SELECT pg_try_advisory_lock(734052) AS acquired`;
    acquired = lock.acquired;
    if (!acquired) return { busy: true, synced: 0, errors: 0 };
    await putSetting("sync_status", JSON.stringify(status));
    const stores = await db()`SELECT * FROM stores ORDER BY group_id,name`;
    const tokens = new Map<
      number,
      Awaited<ReturnType<typeof googleAccess>> | Error
    >();
    for (const group of new Set(stores.map((s) => s.group_id as number)))
      try {
        tokens.set(group, await googleAccess(group));
      } catch (e) {
        tokens.set(group, e as Error);
      }
    for (const store of stores) {
      for (const source of ["ads", "shop"] as const) {
        const previous =
          await db()`SELECT payload FROM reports WHERE store_id=${store.id} AND source=${source} AND payload IS NOT NULL ORDER BY checked_at DESC LIMIT 1`;
        const timezone = previous[0]?.payload?.timezone || "Asia/Kolkata";
        for (const offset of customDate ? [0] : [-1, 0, -2, -3]) {
          let reportDate = customDate || dateInZone(timezone, offset);
          try {
            const token = tokens.get(store.group_id);
            if (source === "ads" && token instanceof Error) throw token;
            const data =
              source === "ads"
                ? await fetchAds(
                    store as any,
                    token as Awaited<ReturnType<typeof googleAccess>>,
                    offset,
                    customDate,
                    endDate,
                  )
                : await fetchShop(store as any, offset, customDate, endDate);
            reportDate = data.date;
            if (customDate && endDate && customDate !== endDate)
              await db()`INSERT INTO report_ranges(store_id,source,start_date,end_date,payload,error) VALUES(${store.id},${source},${customDate},${endDate},${db().json(data as any)},NULL) ON CONFLICT(store_id,source,start_date,end_date) DO UPDATE SET payload=EXCLUDED.payload,error=NULL,checked_at=now()`;
            else
              await db()`INSERT INTO reports(store_id,source,report_date,payload,error) VALUES(${store.id},${source},${reportDate},${db().json(data as any)},NULL) ON CONFLICT(store_id,source,report_date) DO UPDATE SET payload=EXCLUDED.payload,error=NULL,checked_at=now()`;
            status.synced++;
          } catch (e) {
            const message =
              e instanceof Error ? e.message : "Sync failed. Try again.";
            if (customDate && endDate && customDate !== endDate)
              await db()`INSERT INTO report_ranges(store_id,source,start_date,end_date,error) VALUES(${store.id},${source},${customDate},${endDate},${message}) ON CONFLICT(store_id,source,start_date,end_date) DO UPDATE SET error=EXCLUDED.error,checked_at=now()`;
            else
              await db()`INSERT INTO reports(store_id,source,report_date,error) VALUES(${store.id},${source},${reportDate},${message}) ON CONFLICT(store_id,source,report_date) DO UPDATE SET error=EXCLUDED.error,checked_at=now()`;
            status.errors++;
          }
          await putSetting("sync_status", JSON.stringify(status));
        }
      }
    }
    return { busy: false, synced: status.synced, errors: status.errors };
  } catch (error) {
    status.failed = true;
    throw error;
  } finally {
    try {
      if (acquired) {
        status.running = false;
        status.finishedAt = new Date().toISOString();
        await putSetting("sync_status", JSON.stringify(status));
        await connection`SELECT pg_advisory_unlock(734052)`;
      }
    } finally {
      connection.release();
    }
  }
}
