"use client";
import { useEffect, useState } from "react";
import DateRangeFilter from "@/components/date-range-filter";
import { dateInZone, formatMoney } from "@/lib/reporting";
import type {
  CampaignDetail,
  Period,
  Store,
  StoreProductsData,
} from "@/lib/types";
const count = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
export default function CampaignPerformance({
  store,
  campaign,
  currency,
  demo,
}: {
  store: Store;
  campaign: CampaignDetail;
  currency: string;
  demo: boolean;
}) {
  const [range, setRange] = useState(() => ({
    period: "last7" as Period,
    from: dateInZone("Asia/Kolkata", -6),
    to: dateInZone("Asia/Kolkata"),
  }));
  const [data, setData] = useState<StoreProductsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setError("");
    async function load() {
      try {
        if (demo) return;
        const res = await fetch(
          `/api/store-products?id=${encodeURIComponent(store.id)}&from=${range.from}&to=${range.to}`,
          { signal: controller.signal },
        );
        if (res.status === 401) {
          window.location.assign("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok)
          throw Error(body.error || "Could not load campaign performance.");
        if (!controller.signal.aborted) setData(body);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [store.id, range.from, range.to, demo]);
  const days: string[] = [];
  for (
    let date = new Date(`${range.to}T12:00:00Z`);
    date.toISOString().slice(0, 10) >= range.from;
    date.setUTCDate(date.getUTCDate() - 1)
  )
    days.push(date.toISOString().slice(0, 10));
  const daily =
    data?.campaignDaily?.filter((r) => r.campaignId === campaign.id) || [];
  return (
    <section
      className="campaign-performance"
      aria-label={`${campaign.name} daily performance`}
    >
      <div className="products-heading">
        <h4>Daily performance</h4>
        <DateRangeFilter
          period={range.period}
          from={range.from}
          to={range.to}
          onApply={(period, from, to) => setRange({ period, from, to })}
        />
      </div>
      {loading && <p role="status">Loading daily performance…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data?.adsError && (
        <p className="form-error" role="alert">
          {data.adsError}
        </p>
      )}
      {!loading && !error && (
        <>
          <p className="muted">
            {data?.timezone || store.ads?.timezone || "Account time zone"}
            {demo ? " · Example data" : ""}
          </p>
          <div className="campaign-daily-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Spend</th>
                  <th>Clicks</th>
                  <th>Impressions</th>
                  <th>Conversions</th>
                </tr>
              </thead>
              <tbody>
                {days.map((date) => {
                  const row = demo
                    ? {
                        spend:
                          campaign.spend == null
                            ? null
                            : campaign.spend / days.length,
                        clicks:
                          campaign.clicks == null
                            ? null
                            : campaign.clicks / days.length,
                        impressions:
                          campaign.impressions == null
                            ? null
                            : campaign.impressions / days.length,
                        conversions:
                          campaign.conversions == null
                            ? null
                            : campaign.conversions / days.length,
                      }
                    : daily.find((r) => r.date === date);
                  return (
                    <tr key={date}>
                      <td>{date}</td>
                      <td>
                        {formatMoney(row?.spend, data?.currency || currency)}
                      </td>
                      <td>{count(row?.clicks)}</td>
                      <td>{count(row?.impressions)}</td>
                      <td>{count(row?.conversions)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Days without reported figures show —. Conversions include all
            conversion types.
          </p>
        </>
      )}
    </section>
  );
}
