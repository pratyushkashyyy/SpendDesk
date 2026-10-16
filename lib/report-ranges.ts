import type { AdsReport, ShopReport } from "./types";

export function reportDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let time = Date.parse(from); time <= Date.parse(to); time += 86400000)
    dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}

export type SavedReport = {
  store_id: string;
  source: string;
  report_date: string;
  payload: any;
  error: string | null;
  checked_at: Date | string;
};

// Only a complete daily series in one currency/time zone can represent a range.
export function combineDailyReports(
  rows: SavedReport[],
  from: string,
  to: string,
): SavedReport | undefined {
  const dates = reportDates(from, to);
  const daily = dates.map((date) =>
    rows.find((row) => row.report_date === date && row.payload),
  );
  if (!daily.length || daily.some((row) => !row)) return;
  const complete = daily as SavedReport[];
  const latest = complete.reduce((a, b) =>
    new Date(a.checked_at) > new Date(b.checked_at) ? a : b,
  );
  const payloads = complete.map((row) => row.payload);
  const base = latest.payload;
  if (
    payloads.some(
      (p) => p.currency !== base.currency || p.timezone !== base.timezone,
    )
  )
    return;
  const sum = (values: (number | null)[]) =>
    values.some((v) => v == null)
      ? null
      : values.reduce<number>((a, b) => a + b!, 0);
  let payload: AdsReport | ShopReport;
  const date = from === to ? from : `${from} – ${to}`;
  if (latest.source === "ads") {
    const campaigns = new Map<string, any>();
    for (const p of payloads)
      for (const campaign of p.campaigns) {
        const previous = campaigns.get(campaign.id);
        campaigns.set(campaign.id, {
          ...campaign,
          spend: previous
            ? sum([previous.spend, campaign.spend])
            : campaign.spend,
          impressions: previous
            ? sum([previous.impressions ?? null, campaign.impressions ?? null])
            : campaign.impressions,
        });
      }
    payload = {
      ...base,
      date,
      spend: sum(payloads.map((p) => p.spend)),
      purchases: sum(payloads.map((p) => p.purchases)),
      campaigns: [...campaigns.values()],
      budgetEligibility: {
        budgetIds: [
          ...new Set(
            payloads.flatMap((p) => p.budgetEligibility?.budgetIds || []),
          ),
        ] as string[],
        complete: payloads.every((p) => p.budgetEligibility?.complete),
        from,
        to,
      },
      costPerPurchase: null,
      costNote:
        "Unavailable for a range assembled from saved daily reports. Refresh this range for Google's source cost per purchase.",
      raw: undefined,
    };
  } else {
    payload = {
      ...base,
      date,
      sales: sum(payloads.map((p) => p.sales)),
      orders: sum(payloads.map((p) => p.orders)),
      raw: undefined,
    };
  }
  // Freshness describes the oldest daily snapshot used, not the time of this read.
  const oldest = complete.reduce((a, b) =>
    new Date(a.checked_at) < new Date(b.checked_at) ? a : b,
  );
  payload.fetchedAt = oldest.payload.fetchedAt;
  return {
    ...oldest,
    report_date: date,
    payload,
    error:
      [...new Set(complete.map((r) => r.error).filter(Boolean))].join("; ") ||
      null,
  };
}
