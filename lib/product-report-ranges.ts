import { reportDates } from "./report-ranges";
import type {
  CampaignDetail,
  ProductPerformance,
  StoreProductsData,
} from "./types";

const sum = (values: (number | null | undefined)[]) =>
  values.some((v) => v == null)
    ? null
    : values.reduce<number>((n, v) => n + v!, 0);

export function aggregateProductPerformance(
  rows: ProductPerformance[],
): ProductPerformance[] {
  const groups = new Map<string, ProductPerformance[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.campaignId, row.itemId]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return [...groups.values()].map((items) => ({
    itemId: items.at(-1)!.itemId,
    title: items.at(-1)!.title,
    campaignId: items.at(-1)!.campaignId,
    spend: sum(items.map((r) => r.spend)),
    clicks: sum(items.map((r) => r.clicks)),
    impressions: sum(items.map((r) => r.impressions)),
    conversions: sum(items.map((r) => r.conversions)),
  }));
}

// Weight Google's daily cost/conversion by conversions. Never average daily
// ratios or substitute total spend (which can include ineligible interactions).
function conversionCost(rows: CampaignDetail[]) {
  const conversions = sum(rows.map((r) => r.conversions));
  if (conversions == null || conversions <= 0) return null;
  if (rows.some((r) => (r.conversions || 0) > 0 && r.costPerConversion == null))
    return null;
  return (
    rows.reduce(
      (total, r) => total + (r.costPerConversion || 0) * (r.conversions || 0),
      0,
    ) / conversions
  );
}

export function productDays(data: StoreProductsData, from: string, to: string) {
  return reportDates(from, to).map((date): StoreProductsData => ({
    ...data,
    syncComplete: true,
    date,
    raw: undefined,
    campaigns: data.campaigns.map((campaign) => {
      const day = data.campaignDaily?.find(
        (r) => r.campaignId === campaign.id && r.date === date,
      );
      return {
        ...campaign,
        spend: day ? day.spend : 0,
        clicks: day ? day.clicks : 0,
        impressions: day ? day.impressions : 0,
        conversions: day ? day.conversions : 0,
        costPerConversion: day?.costPerConversion ?? null,
      };
    }),
    campaignDaily: data.campaignDaily?.filter((r) => r.date === date) || [],
    productDaily: data.productDaily?.filter((r) => r.date === date) || [],
    performance: aggregateProductPerformance(
      data.productDaily?.filter((r) => r.date === date) || [],
    ),
  }));
}

export type ProductSnapshot = {
  from: string;
  to: string;
  payload: StoreProductsData;
  checkedAt: string | Date;
};

export function combineProductSnapshots(
  rows: ProductSnapshot[],
  from: string,
  to: string,
): StoreProductsData | undefined {
  const exact = rows.find((r) => r.from === from && r.to === to);
  const days = reportDates(from, to).map((date) =>
    rows.find(
      (r) => r.from === date && r.to === date && r.payload.syncComplete,
    ),
  );
  if (days.some((day) => !day)) return exact?.payload;
  const covered = days as ProductSnapshot[];
  const latest = covered.reduce((a, b) =>
    new Date(a.checkedAt) > new Date(b.checkedAt) ? a : b,
  );
  if (exact && new Date(exact.checkedAt) >= new Date(latest.checkedAt))
    return exact.payload;
  if (
    covered.some(
      (r) =>
        r.payload.currency !== latest.payload.currency ||
        r.payload.timezone !== latest.payload.timezone,
    )
  )
    return exact?.payload;
  const oldest = covered.reduce((a, b) =>
    new Date(a.payload.fetchedAt) < new Date(b.payload.fetchedAt) ? a : b,
  );
  const campaigns = new Map<string, CampaignDetail[]>();
  for (const day of [...covered].sort(
    (a, b) => +new Date(a.checkedAt) - +new Date(b.checkedAt),
  ))
    for (const campaign of day.payload.campaigns)
      campaigns.set(campaign.id, [
        ...(campaigns.get(campaign.id) || []),
        campaign,
      ]);
  return {
    ...latest.payload,
    raw: undefined,
    date: from === to ? from : `${from} – ${to}`,
    syncComplete: true,
    fetchedAt: oldest.payload.fetchedAt,
    campaigns: [...campaigns.values()].map((items) => ({
      ...items.at(-1)!,
      spend: sum(items.map((r) => r.spend)),
      clicks: sum(items.map((r) => r.clicks)),
      impressions: sum(items.map((r) => r.impressions)),
      conversions: sum(items.map((r) => r.conversions)),
      costPerConversion: conversionCost(items),
    })),
    campaignDaily: covered
      .flatMap((r) => r.payload.campaignDaily || [])
      .sort((a, b) => b.date.localeCompare(a.date)),
    productDaily: covered.flatMap((r) => r.payload.productDaily || []),
    performance: aggregateProductPerformance(
      covered.flatMap((r) => r.payload.performance),
    ),
    adsError: null,
  };
}
