import { db } from "./db";
import { fetchCatalog, fetchProductAds } from "./products";
import type { StoreProductsData } from "../types";
export async function storeProducts(
  store: any,
  startDate: string,
  endDate: string,
  currency: string,
  timezone: string,
  force = false,
): Promise<StoreProductsData> {
  const sql = db();
  const lock = await sql.reserve();
  const key = `products:${store.id}:${startDate}:${endDate}`;
  try {
    await lock`SELECT pg_advisory_lock(hashtextextended(${key},0))`;
    const [cached] =
      await sql`SELECT payload,checked_at FROM store_product_snapshots WHERE store_id=${store.id} AND start_date=${startDate} AND end_date=${endDate}`;
    const previous = cached?.payload as StoreProductsData | undefined;
    const ttl =
      previous?.catalogError || previous?.adsError ? 5 * 60000 : 60 * 60000;
    let data = previous;
    const targetCpaMissing =
      !!data?.campaigns?.some((campaign) => !Object.hasOwn(campaign, "targetCpa"));
    if (
      !data ||
      !data.campaignDaily ||
      targetCpaMissing ||
      force ||
      Date.now() - Date.parse(cached.checked_at) > ttl
    ) {
      const [catalog, ads] = await Promise.allSettled([
        fetchCatalog(store),
        fetchProductAds(store, startDate, endDate),
      ]);
      data = {
        campaignDaily:
          ads.status === "fulfilled"
            ? ads.value.campaignDaily
            : previous?.campaignDaily || [],
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
        date: startDate === endDate ? startDate : `${startDate} – ${endDate}`,
        currency,
        timezone,
        links: [],
        catalogError:
          catalog.status === "rejected" ? catalog.reason.message : null,
        adsError: ads.status === "rejected" ? ads.reason.message : null,
        fetchedAt: new Date().toISOString(),
      };
      await sql`INSERT INTO store_product_snapshots(store_id,start_date,end_date,payload) VALUES(${store.id},${startDate},${endDate},${sql.json(data as any)}) ON CONFLICT(store_id,start_date,end_date) DO UPDATE SET payload=EXCLUDED.payload,checked_at=now()`;
    }
    const links =
      await sql`SELECT product_id,campaign_id FROM product_campaign_links WHERE store_id=${store.id}`;
    return {
      ...data,
      links: links.map((r) => ({
        productId: r.product_id,
        campaignId: r.campaign_id,
      })),
    };
  } finally {
    try {
      await lock`SELECT pg_advisory_unlock(hashtextextended(${key},0))`;
    } finally {
      lock.release();
    }
  }
}
