import { db } from "./db";
import { fetchCatalog, fetchProductAds } from "./products";
import { GoogleQuotaPause } from "./google-quota";
import type { AdsAuth } from "./google";
import { combineProductSnapshots, productDays } from "../product-report-ranges";
import type { StoreProductsData } from "../types";

export async function savedStoreProducts(
  storeId: string,
  from: string,
  to: string,
  sql = db(),
  includeRaw = false,
) {
  const rows =
    await sql`SELECT start_date::text AS "from",end_date::text AS "to",CASE WHEN ${includeRaw} THEN payload ELSE payload - 'raw' - 'productDaily' END AS payload,checked_at AS "checkedAt"
    FROM store_product_snapshots WHERE store_id=${storeId}
    AND ((start_date=${from}::date AND end_date=${to}::date)
      OR (start_date=end_date AND start_date BETWEEN ${from}::date AND ${to}::date))`;
  return combineProductSnapshots(rows as any, from, to);
}

// The caller supplies a reserved connection. One lock per store coordinates
// overlapping date ranges and manual refreshes without blocking database reads.
export async function refreshStoreProducts(
  store: any,
  from: string,
  to: string,
  currency: string,
  timezone: string,
  sql: ReturnType<typeof db>,
  background: boolean,
  auth?: AdsAuth,
): Promise<StoreProductsData> {
  const key = `products:${store.id}`;
  await sql`SELECT pg_advisory_lock(hashtextextended(${key},0))`;
  try {
    const previous = await savedStoreProducts(store.id, from, to, sql, true);
    const [catalog, ads] = await Promise.allSettled([
      store.shop_cipher ? fetchCatalog(store) : Promise.resolve([]),
      fetchProductAds(store, from, to, sql, background, auth),
    ]);
    if (ads.status === "rejected" && ads.reason instanceof GoogleQuotaPause)
      throw ads.reason;
    const data: StoreProductsData = {
      syncComplete: ads.status === "fulfilled",
      campaignDaily:
        ads.status === "fulfilled"
          ? ads.value.campaignDaily
          : previous?.campaignDaily || [],
      productDaily:
        ads.status === "fulfilled"
          ? ads.value.productDaily
          : previous?.productDaily || [],
      products:
        catalog.status === "fulfilled"
          ? catalog.value
          : previous?.products || [],
      campaigns:
        ads.status === "fulfilled"
          ? ads.value.campaigns
          : previous?.campaigns || [],
      performance:
        ads.status === "fulfilled"
          ? ads.value.performance
          : previous?.performance || [],
      raw: ads.status === "fulfilled" ? ads.value.raw : previous?.raw,
      date: from === to ? from : `${from} – ${to}`,
      currency,
      timezone,
      links: [],
      catalogError:
        catalog.status === "rejected" ? catalog.reason.message : null,
      adsError: ads.status === "rejected" ? ads.reason.message : null,
      fetchedAt:
        ads.status === "fulfilled"
          ? new Date().toISOString()
          : previous?.fetchedAt || new Date().toISOString(),
    };
    const entries =
      ads.status === "fulfilled"
        ? productDays(data, from, to).map((day) => ({
            from: day.date,
            to: day.date,
            payload: day,
          }))
        : [];
    // Keep Google's exact range totals as well as reusable daily records.
    if (from !== to || !entries.length)
      entries.push({ from, to, payload: data });
    else entries[0].payload = data;
    await sql`INSERT INTO store_product_snapshots(store_id,start_date,end_date,payload)
      SELECT ${store.id}::uuid,(entry->>'from')::date,(entry->>'to')::date,entry->'payload'
      FROM jsonb_array_elements(${sql.json(entries as any)}) AS entry
      ON CONFLICT(store_id,start_date,end_date) DO UPDATE SET payload=EXCLUDED.payload,checked_at=now()`;
    return data;
  } finally {
    await sql`SELECT pg_advisory_unlock(hashtextextended(${key},0))`;
  }
}

export async function storeProducts(
  store: any,
  startDate: string,
  endDate: string,
  currency: string,
  timezone: string,
  force = false,
): Promise<StoreProductsData> {
  let data: StoreProductsData | undefined;
  if (force) {
    const lock = await db().reserve();
    try {
      data = await refreshStoreProducts(
        store,
        startDate,
        endDate,
        currency,
        timezone,
        lock,
        false,
      );
    } finally {
      lock.release();
    }
  } else data = await savedStoreProducts(store.id, startDate, endDate);
  const links =
    await db()`SELECT product_id,campaign_id FROM product_campaign_links WHERE store_id=${store.id}`;
  const { raw, productDaily, ...visible } = data || {
    products: [],
    campaigns: [],
    campaignDaily: [],
    performance: [],
    date: startDate === endDate ? startDate : `${startDate} – ${endDate}`,
    currency,
    timezone,
    catalogError: null,
    adsError:
      "No saved campaign data for these dates yet. Run sync to save it.",
    fetchedAt: "",
    syncComplete: false,
  };
  return {
    ...visible,
    links: links.map((r) => ({
      productId: r.product_id,
      campaignId: r.campaign_id,
    })),
  };
}
