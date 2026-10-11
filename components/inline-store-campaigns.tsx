"use client";
import { useState } from "react";
import DateRangeFilter from "@/components/date-range-filter";
import StoreProducts from "@/components/store-products";
import { dateInZone } from "@/lib/reporting";
import type { Period, Store } from "@/lib/types";
export default function InlineStoreCampaigns({
  store,
  demo,
}: {
  store: Store;
  demo: boolean;
}) {
  const [range, setRange] = useState(() => ({
    period: "last7" as Period,
    from: dateInZone("Asia/Kolkata", -6),
    to: dateInZone("Asia/Kolkata"),
  }));
  return (
    <section
      className="inline-store-campaigns"
      aria-label={`${store.name} campaign performance`}
    >
      <div className="products-heading">
        <h3>{store.name} campaigns</h3>
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
      <StoreProducts
        store={store}
        demo={demo}
        from={range.from}
        to={range.to}
        initialTab="campaigns"
      />
    </section>
  );
}
