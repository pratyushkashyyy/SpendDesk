"use client";
import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import DateRangeFilter from "@/components/date-range-filter";
import StoreProducts from "@/components/store-products";
import type { Period, Store } from "@/lib/types";
export default function InlineStoreCampaigns({
  store,
  demo,
  initialRange,
}: {
  store: Store;
  demo: boolean;
  initialRange: { period: Period; from: string; to: string };
}) {
  const [range, setRange] = useState(initialRange);
  return (
    <section
      className="inline-store-campaigns"
      aria-label={`${store.name} campaign performance`}
    >
      <div className="products-heading">
        <div>
          <h3>{store.name} campaigns</h3>
        </div>
        <DateRangeFilter
          period={range.period}
          from={range.from}
          to={range.to}
          onApply={(period, from, to) => setRange({ period, from, to })}
        />
      </div>
      {store.adsError && (
        <p className="form-error" role="alert">
          Google Ads: {store.adsError}
        </p>
      )}
      {!!store.ads?.alerts?.length && (
        <details className="inline-policy-summary">
          <summary>
            <TriangleAlert size={14} />
            <strong>
              {store.ads.alerts.length} policy alert
              {store.ads.alerts.length === 1 ? "" : "s"}
            </strong>
            <span>
              {new Set(store.ads.alerts.map((alert) => alert.campaignId)).size}{" "}
              campaign
              {new Set(store.ads.alerts.map((alert) => alert.campaignId))
                .size === 1
                ? ""
                : "s"}
            </span>
            <ChevronDown size={14} className="policy-chevron" />
          </summary>
          <div className="inline-policy-details">
            {store.ads.alerts.map((alert, index) => (
              <div key={index}>
                <strong>
                  {alert.campaignName}{" "}
                  <span>
                    · {alert.status.toLowerCase().replaceAll("_", " ")}
                  </span>
                </strong>
                <p>
                  {alert.adName} ·{" "}
                  {alert.details?.join(" · ") ||
                    "Google Ads reported a policy restriction."}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
      <StoreProducts
        store={store}
        demo={demo}
        from={range.from}
        to={range.to}
        initialTab="campaigns"
        compact
      />
    </section>
  );
}
