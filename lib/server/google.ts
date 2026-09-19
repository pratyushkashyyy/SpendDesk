import { db, getSetting } from "./db";
import { decrypt } from "./crypto";
import { fetchJson } from "./http";
import { dateInZone, micros, numberOrNull } from "../reporting";
import type { AdsReport, Budget } from "../types";
export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  developerToken?: string;
};
export async function googleConfig() {
  const raw = await getSetting("google_config");
  if (!raw) throw new Error("Finish Google Ads API setup in Connections.");
  return decrypt<GoogleConfig>(raw);
}
export async function googleAccess(group: number) {
  const config = await googleConfig();
  const rows =
    await db()`SELECT token_cipher FROM google_connections WHERE group_id=${group}`;
  if (!rows.length) throw new Error(`Connect Google login ${group} first.`);
  const { refreshToken } = decrypt<{ refreshToken: string }>(
    rows[0].token_cipher,
  );
  const token = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!token.access_token) throw new Error("Reconnect your Google account.");
  return { config, accessToken: token.access_token as string };
}
export async function adsQuery(
  cid: string,
  managerCid: string,
  auth: Awaited<ReturnType<typeof googleAccess>>,
  query: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    "Content-Type": "application/json",
  };
  if (managerCid) headers["login-customer-id"] = managerCid;
  const rows: any[] = [];
  let pageToken = "";
  do {
    const data = await fetchJson(
      `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || "v25"}/customers/${cid}/googleAds:search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      },
    );
    rows.push(...(data.results || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return rows;
}
export async function fetchAds(
  store: { cid: string; manager_cid: string },
  auth: Awaited<ReturnType<typeof googleAccess>>,
  offset: number,
  customDate?: string,
  endDate?: string,
): Promise<AdsReport> {
  const query = (q: string) => adsQuery(store.cid, store.manager_cid, auth, q);
  const [metadata] = await query(
    "SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1",
  );
  if (!metadata?.customer)
    throw new Error("Could not read Google Ads account settings.");
  const currency = metadata.customer.currencyCode,
    timezone = metadata.customer.timeZone;
  const date = customDate || dateInZone(timezone, offset);
  const lastDate = endDate || date;
  const dateFilter =
    date === lastDate
      ? `segments.date = '${date}'`
      : `segments.date BETWEEN '${date}' AND '${lastDate}'`;
  const [totals, categories, campaigns] = await Promise.all([
    query(
      `SELECT metrics.cost_micros, metrics.cost_per_conversion, metrics.conversions FROM customer WHERE ${dateFilter}`,
    ),
    query(
      `SELECT segments.conversion_action_category, metrics.conversions FROM customer WHERE ${dateFilter}`,
    ),
    query(
      `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.period, metrics.cost_micros FROM campaign WHERE ${dateFilter}`,
    ),
  ]);
  // Budget-only query also includes active campaigns with zero delivery in the selected period.
  const configured = await query(
    "SELECT campaign.id, campaign.name, campaign.status, campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.period FROM campaign WHERE campaign.status != REMOVED",
  );
  const budgets = new Map<string, Budget>();
  for (const row of configured) {
    const b = row.campaignBudget;
    if (!b?.id) continue;
    const found = budgets.get(b.id);
    if (found) found.campaigns.push(row.campaign.name);
    else
      budgets.set(b.id, {
        id: b.id,
        name: b.name,
        amount: b.period === "DAILY" ? micros(b.amountMicros) : null,
        shared: !!b.explicitlyShared,
        period: b.period,
        campaigns: [row.campaign.name],
      });
  }
  const purchase = categories.find(
    (r) => r.segments?.conversionActionCategory === "PURCHASE",
  );
  const purchases = numberOrNull(purchase?.metrics?.conversions);
  const onlyPurchase =
    !!purchase &&
    categories.every(
      (r) =>
        r.segments?.conversionActionCategory === "PURCHASE" ||
        Number(r.metrics?.conversions || 0) === 0,
    );
  const cost =
    onlyPurchase && (purchases ?? 0) > 0
      ? micros(totals[0]?.metrics?.costPerConversion)
      : null;
  return {
    spend: micros(totals[0]?.metrics?.costMicros),
    purchases,
    costPerPurchase: cost,
    costNote:
      cost !== null
        ? "Google Ads cost / conversion; all reported conversions in this period are purchases."
        : "Unavailable as a purchase-only source metric. No cost per purchase is calculated.",
    currency,
    timezone,
    date: date === lastDate ? date : `${date} – ${lastDate}`,
    budgets: [...budgets.values()],
    campaigns: campaigns.map((r) => ({
      id: r.campaign.id,
      name: r.campaign.name,
      status: r.campaign.status,
      budgetId: r.campaignBudget.id,
      spend: micros(r.metrics?.costMicros),
    })),
    fetchedAt: new Date().toISOString(),
    raw: { totals, categories, campaigns, configured },
  };
}
