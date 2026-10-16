import { recordHealth, googleAuthFailure } from "./connection-health";
import { db, getSetting } from "./db";
import { decrypt } from "./crypto";
import { fetchJson } from "./http";
import { dateInZone, micros, numberOrNull } from "../reporting";
import { reportDates } from "../report-ranges";
import { googleQuotaScope, requestGoogleAds } from "./google-quota";
import type { AdsReport, Budget } from "../types";
import {
  activeBudget,
  campaignActivity,
  campaignChangesQuery,
  configuredCampaignQuery,
} from "../campaign-activity";
export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  developerToken?: string;
};
export async function googleConfig(sql = db()) {
  const raw = await getSetting("google_config", sql);
  if (!raw) throw new Error("Finish Google Ads API setup in Connections.");
  return decrypt<GoogleConfig>(raw);
}
export async function googleAccess(
  group: number,
  sql = db(),
  background = false,
) {
  const config = await googleConfig(sql);
  const rows =
    await sql`SELECT token_cipher FROM google_connections WHERE group_id=${group}`;
  if (!rows.length) throw new Error(`Connect Google login ${group} first.`);
  const { refreshToken } = decrypt<{ refreshToken: string }>(
    rows[0].token_cipher,
  );
  try {
    const token = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (!token.access_token)
      throw new Error(
        "Google did not grant access. Reconnect your Google account.",
      );
    await recordHealth(
      "google",
      group,
      "healthy",
      "Google authorization verified.",
      sql,
    );
    return {
      config,
      accessToken: token.access_token as string,
      sql,
      background,
    };
  } catch (error) {
    const health = googleAuthFailure(error);
    await recordHealth("google", group, health.status, health.message, sql);
    throw new Error(health.message);
  }
}
export type AdsAuth = {
  config: GoogleConfig;
  accessToken: string;
  sql?: ReturnType<typeof db>;
  background?: boolean;
};
type AdsTransport = (
  url: string,
  init: RequestInit,
  auth: AdsAuth,
) => Promise<any>;
// Local ordering avoids concurrent queries from one report competing during a retry;
// PostgreSQL enforces the actual spacing and quota across every process.
let adsQueue: Promise<unknown> = Promise.resolve();
const governedTransport: AdsTransport = (url, init, auth) => {
  const request = adsQueue.then(() =>
    requestGoogleAds(url, init, {
      scope: googleQuotaScope(auth.config.clientId),
      sql: auth.sql,
      background: auth.background,
    }),
  );
  adsQueue = request.catch(() => {});
  return request;
};
export function createAdsQuery(transport: AdsTransport) {
  return async function adsQuery(
    cid: string,
    managerCid: string,
    auth: AdsAuth,
    query: string,
  ) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    };
    if (auth.config.developerToken)
      headers["developer-token"] = auth.config.developerToken;
    if (managerCid) headers["login-customer-id"] = managerCid;
    const rows: any[] = [];
    let pageToken = "";
    do {
      const data = await transport(
        `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || "v25"}/customers/${cid}/googleAds:search`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
        },
        auth,
      );
      rows.push(...(data.results || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return rows;
  };
}
export const adsQuery = createAdsQuery(governedTransport);
function policyDetails(entries: any[] = []) {
  return entries
    .map((entry) => {
      const topic = String(entry.topic || "")
        .toLowerCase()
        .replaceAll("_", " ");
      const effect = String(entry.type || "")
        .toLowerCase()
        .replaceAll("_", " ");
      if (!topic && !effect) return "";
      if (!topic) return effect;
      if (!effect) return topic;
      return `${topic} — ${effect}`;
    })
    .filter(Boolean);
}
export async function fetchAds(
  store: { cid: string; manager_cid: string },
  auth: AdsAuth,
  offset: number,
  customDate?: string,
  endDate?: string,
  options: { recentDays?: number; query?: (q: string) => Promise<any[]> } = {},
): Promise<AdsReport> {
  const query =
    options.query ||
    ((q: string) => adsQuery(store.cid, store.manager_cid, auth, q));
  const [metadata] = await query(
    "SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1",
  );
  if (!metadata?.customer)
    throw new Error("Could not read Google Ads account settings.");
  const currency = metadata.customer.currencyCode,
    timezone = metadata.customer.timeZone;
  const date =
    customDate ||
    dateInZone(timezone, offset - ((options.recentDays || 1) - 1));
  const lastDate = endDate || customDate || dateInZone(timezone, offset);
  const dateFilter =
    date === lastDate
      ? `segments.date = '${date}'`
      : `segments.date BETWEEN '${date}' AND '${lastDate}'`;
  const totals = await query(
    `SELECT metrics.cost_micros, metrics.cost_per_conversion, metrics.conversions FROM customer WHERE ${dateFilter}`,
  );
  const categories = await query(
    `SELECT segments.conversion_action_category, metrics.conversions FROM customer WHERE ${dateFilter}`,
  );
  const campaigns = await query(
    `SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type, campaign.target_cpa.target_cpa_micros, campaign.maximize_conversions.target_cpa_micros, bidding_strategy.target_cpa.target_cpa_micros, campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.period, metrics.cost_micros, metrics.impressions FROM campaign WHERE ${dateFilter}`,
  );
  const policyAds = await query(
    "SELECT campaign.id, campaign.name, ad_group_ad.ad.name, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.policy_topic_entries FROM ad_group_ad WHERE campaign.status != REMOVED AND ad_group_ad.status != REMOVED AND ad_group_ad.policy_summary.approval_status IN (DISAPPROVED, AREA_OF_INTEREST_ONLY, APPROVED_LIMITED)",
  );
  const policyAssets = await query(
    "SELECT campaign.id, campaign.name, asset_group.name, asset_group_asset.policy_summary.approval_status, asset_group_asset.policy_summary.policy_topic_entries FROM asset_group_asset WHERE campaign.status != REMOVED AND asset_group_asset.status != REMOVED AND asset_group_asset.policy_summary.approval_status IN (DISAPPROVED, AREA_OF_INTEREST_ONLY, APPROVED_LIMITED)",
  );
  const configured = await query(configuredCampaignQuery);
  let changes: any[] = [],
    activityError: string | undefined;
  try {
    changes = await query(
      campaignChangesQuery(dateInZone(timezone, -29), dateInZone(timezone, 1)),
    );
  } catch (error) {
    // History enrichment must not discard successful spend/order reports.
    activityError =
      error instanceof Error
        ? error.message
        : "Campaign history is unavailable.";
  }
  const activity = campaignActivity(
    configured,
    changes,
    timezone,
    new Date().toISOString(),
    activityError,
  );
  const budgets = new Map<string, Budget>();
  for (const row of configured) {
    if (row.campaign?.status === "REMOVED") continue;
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
  const report: AdsReport = {
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
      impressions: numberOrNull(r.metrics?.impressions),
      targetCpa: micros(
        r.campaign?.maximizeConversions?.targetCpaMicros ??
          r.campaign?.targetCpa?.targetCpaMicros ??
          r.biddingStrategy?.targetCpa?.targetCpaMicros,
      ),
      biddingStrategy: r.campaign?.biddingStrategyType || "",
    })),
    alerts: [
      ...policyAds.map((r) => ({
        campaignId: r.campaign.id,
        campaignName: r.campaign.name,
        adName: r.adGroupAd.ad.name || "Ad",
        status: r.adGroupAd.policySummary.approvalStatus,
        details: policyDetails(r.adGroupAd.policySummary.policyTopicEntries),
      })),
      ...policyAssets.map((r) => ({
        campaignId: r.campaign.id,
        campaignName: r.campaign.name,
        adName: `Asset group ${r.assetGroup.name}`,
        status: r.assetGroupAsset.policySummary.approvalStatus,
        details: policyDetails(
          r.assetGroupAsset.policySummary.policyTopicEntries,
        ),
      })),
    ],
    fetchedAt: new Date().toISOString(),
    raw: {
      totals,
      categories,
      campaigns,
      configured,
      campaignActivity: activity,
    },
  };
  if (date !== lastDate) {
    const dailyTotals = await query(
      `SELECT segments.date, metrics.cost_micros, metrics.cost_per_conversion, metrics.conversions FROM customer WHERE ${dateFilter}`,
    );
    const dailyCategories = await query(
      `SELECT segments.date, segments.conversion_action_category, metrics.conversions FROM customer WHERE ${dateFilter}`,
    );
    const dailyCampaigns = await query(
      `SELECT segments.date, campaign.id, metrics.cost_micros, metrics.impressions FROM campaign WHERE ${dateFilter}`,
    );
    if (
      [...dailyTotals, ...dailyCategories, ...dailyCampaigns].some(
        (row) => !row.segments?.date,
      )
    )
      throw new Error("Google did not return dated daily report rows.");
    const dailyReports = reportDates(date, lastDate).map((day): AdsReport => {
      const total = dailyTotals.find((r) => r.segments?.date === day);
      const categories = dailyCategories.filter(
        (r) => r.segments?.date === day,
      );
      const purchase = categories.find(
        (r) => r.segments?.conversionActionCategory === "PURCHASE",
      );
      const purchases = purchase
        ? numberOrNull(purchase.metrics?.conversions)
        : 0;
      const onlyPurchase =
        !!purchase &&
        categories.every(
          (r) =>
            r.segments?.conversionActionCategory === "PURCHASE" ||
            Number(r.metrics?.conversions || 0) === 0,
        );
      const dailyReport: AdsReport = {
        ...report,
        date: day,
        spend: total ? micros(total.metrics?.costMicros) : 0,
        purchases,
        costPerPurchase:
          onlyPurchase && (purchases ?? 0) > 0
            ? micros(total?.metrics?.costPerConversion)
            : null,
        campaigns: report.campaigns.map((campaign) => {
          const row = dailyCampaigns.find(
            (r) => r.segments?.date === day && r.campaign.id === campaign.id,
          );
          return {
            ...campaign,
            spend: row ? micros(row.metrics?.costMicros) : 0,
            impressions: row ? numberOrNull(row.metrics?.impressions) : 0,
          };
        }),
        raw: { totals: total ? [total] : [], categories },
      };
      const eligible = activeBudget(dailyReport, activity);
      dailyReport.budgetEligibility = {
        budgetIds: eligible.budgetIds,
        complete: eligible.complete,
        from: day,
        to: day,
      };
      return dailyReport;
    });
    (report.raw as any).dailyReports = dailyReports;
  }
  const eligible = activeBudget(report, activity);
  report.budgetEligibility = {
    budgetIds: eligible.budgetIds,
    complete: eligible.complete,
    from: date,
    to: lastDate,
  };
  return report;
}
