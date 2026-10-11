import { db } from "./db";
import { decrypt } from "./crypto";
import { adsQuery, googleAccess } from "./google";
import { shopAccess, shopGraphql, type ShopCredentials } from "./shopify";
import { micros, numberOrNull } from "../reporting";
import type {
  CatalogProduct,
  CampaignDetail,
  ProductPerformance,
} from "../types";
export const CATALOG_QUERY = `query StoreProducts($after: String) {
  products(first: 20, after: $after) {
    nodes { id title handle status
      variants(first: 20) { nodes { id title sku price } pageInfo { hasNextPage endCursor } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const VARIANTS_QUERY = `query ProductVariants($id: ID!, $after: String) {
  product(id: $id) { variants(first: 100, after: $after) {
    nodes { id title sku price } pageInfo { hasNextPage endCursor }
  } }
}`;
export async function fetchCatalog(store: {
  domain: string;
  shop_cipher: string | null;
}): Promise<CatalogProduct[]> {
  if (!store.shop_cipher)
    throw Error("Connect Shopify to load this store’s products.");
  const token = await shopAccess(
    store.domain,
    decrypt<ShopCredentials>(store.shop_cipher),
  );
  // Product access is distinct from reporting access; give the relevant scope on failure.
  const query = async (code: string, vars: Record<string, unknown>) => {
    try {
      return await shopGraphql(store.domain, token, code, vars);
    } catch {
      throw Error(
        "Product catalog unavailable. Check this store’s Shopify token and read_products permission.",
      );
    }
  };
  const products: CatalogProduct[] = [];
  let after: string | null = null;
  do {
    const data = await query(CATALOG_QUERY, { after });
    if (!data?.products)
      throw Error("Shopify did not return its product catalog.");
    for (const p of data.products.nodes) {
      const variants = [...p.variants.nodes];
      let page = p.variants.pageInfo;
      while (page.hasNextPage) {
        if (!page.endCursor)
          throw Error("Shopify variant pagination was incomplete.");
        const next = await query(VARIANTS_QUERY, {
          id: p.id,
          after: page.endCursor,
        });
        if (!next?.product?.variants)
          throw Error("Shopify product variants could not be loaded.");
        variants.push(...next.product.variants.nodes);
        const newPage = next.product.variants.pageInfo;
        if (newPage.hasNextPage && newPage.endCursor === page.endCursor)
          throw Error("Shopify variant pagination did not advance.");
        page = newPage;
      }
      products.push({
        id: p.id,
        title: p.title,
        handle: p.handle,
        status: p.status,
        image: null,
        variants,
      });
    }
    const page = data.products.pageInfo;
    if (page.hasNextPage && (!page.endCursor || page.endCursor === after))
      throw Error("Shopify catalog pagination did not advance.");
    after = page.hasNextPage ? page.endCursor : null;
  } while (after);
  return products;
}
export async function fetchProductAds(
  store: { cid: string; manager_cid: string; group_id: number },
  startDate: string,
  endDate = startDate,
  sql = db(),
) {
  const auth = await googleAccess(store.group_id, sql);
  const query = (q: string) => adsQuery(store.cid, store.manager_cid, auth, q);
  const fields =
    "campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.target_cpa.target_cpa_micros, campaign.maximize_conversions.target_cpa_micros, bidding_strategy.target_cpa.target_cpa_micros, campaign_budget.id, campaign_budget.amount_micros, campaign_budget.period, campaign_budget.explicitly_shared";
  const dateFilter =
    startDate === endDate
      ? `segments.date = '${startDate}'`
      : `segments.date BETWEEN '${startDate}' AND '${endDate}'`;
  const [configured, totals, performance, daily] = await Promise.all([
    query(`SELECT ${fields} FROM campaign WHERE campaign.status != REMOVED`),
    query(
      `SELECT campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE ${dateFilter}`,
    ),
    query(
      `SELECT campaign.id, segments.product_item_id, segments.product_title, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM shopping_performance_view WHERE ${dateFilter}`,
    ),
    query(
      `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE ${dateFilter} ORDER BY segments.date DESC`,
    ),
  ]);
  const campaigns: CampaignDetail[] = configured.map((r) => {
    const m = totals.find((t) => t.campaign.id === r.campaign.id)?.metrics;
    return {
      id: r.campaign.id,
      name: r.campaign.name,
      status: r.campaign.status,
      channel: r.campaign.advertisingChannelType,
      budgetId: r.campaignBudget?.id || "",
      budget:
        r.campaignBudget?.period === "DAILY"
          ? micros(r.campaignBudget.amountMicros)
          : null,
      budgetPeriod: r.campaignBudget?.period || "",
      sharedBudget: !!r.campaignBudget?.explicitlyShared,
      targetCpa: micros(
        r.campaign?.maximizeConversions?.targetCpaMicros ??
          r.campaign?.targetCpa?.targetCpaMicros ??
          r.biddingStrategy?.targetCpa?.targetCpaMicros,
      ),
      biddingStrategy: r.campaign?.biddingStrategyType || "",
      spend: micros(m?.costMicros),
      clicks: numberOrNull(m?.clicks),
      impressions: numberOrNull(m?.impressions),
      conversions: numberOrNull(m?.conversions),
    };
  });
  const rows: ProductPerformance[] = performance.map((r) => ({
    itemId: r.segments.productItemId,
    title: r.segments.productTitle || r.segments.productItemId,
    campaignId: r.campaign.id,
    spend: micros(r.metrics?.costMicros),
    clicks: numberOrNull(r.metrics?.clicks),
    impressions: numberOrNull(r.metrics?.impressions),
    conversions: numberOrNull(r.metrics?.conversions),
  }));
  return {
    campaigns,
    performance: rows,
    campaignDaily: daily.map((r) => ({
      campaignId: r.campaign.id,
      date: r.segments.date,
      spend: micros(r.metrics?.costMicros),
      clicks: numberOrNull(r.metrics?.clicks),
      impressions: numberOrNull(r.metrics?.impressions),
      conversions: numberOrNull(r.metrics?.conversions),
    })),
  };
}
