"use client";
import { ArrowUpRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import StoreProducts from "@/components/store-products";
import { formatMoney } from "@/lib/reporting";
import type { Store } from "@/lib/types";
const count = (value: number | null | undefined) =>
  value == null ? "—" : new Intl.NumberFormat("en-IN").format(value);
export default function StoreDetails({
  selected,
  demo,
  from,
  to,
  onEdit,
}: {
  selected: Store;
  demo: boolean;
  from: string;
  to: string;
  onEdit?: () => void;
}) {
  return (
    <div className="sheet-body">
      <div className="detail-id">
        CID <strong>{selected.cid}</strong>
        {!demo && onEdit && (
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit connection
          </Button>
        )}
      </div>
      <div className="detail-metrics">
        <div>
          <small>Shopify orders</small>
          <strong>{count(selected.shop?.orders)}</strong>
        </div>
        <div>
          <small>Google Ads spend</small>
          <strong>
            {formatMoney(selected.ads?.spend, selected.ads?.currency)}
          </strong>
        </div>
      </div>
      <section className="store-warnings" aria-label="Store warnings">
        <h3>Warnings & connection status</h3>
        {selected.adsError && (
          <p role="alert" className="form-error">
            <strong>Google Ads: </strong>
            {selected.adsError}
          </p>
        )}
        {selected.shopError && (
          <p role="alert" className="form-error">
            <strong>Shopify: </strong>
            {selected.shopError}
          </p>
        )}
        {!selected.ads && !selected.adsError && (
          <p className="muted">Google Ads has not synced yet.</p>
        )}
        {!selected.shop && !selected.shopError && (
          <p className="muted">Shopify has not synced yet.</p>
        )}
        {[selected.ads, selected.shop].some(
          (r) => r && Date.now() - Date.parse(r.fetchedAt) > 3600000,
        ) && (
          <p className="form-error">
            Reports are more than an hour old. Refresh dashboard data for
            current figures.
          </p>
        )}
        {selected.ads?.campaigns
          .filter((c) => c.status !== "ENABLED")
          .map((c) => (
            <p className="form-error" key={c.id}>
              Campaign {c.name}: {c.status.toLowerCase().replaceAll("_", " ")}
            </p>
          ))}
        {selected.ads?.alerts?.map((alert, index) => (
          <p
            className="form-error"
            key={`${alert.campaignId}:${alert.adName}:${index}`}
          >
            <strong>Google Ads policy alert: </strong>
            {alert.campaignName} · {alert.adName} ·{" "}
            {alert.status.toLowerCase().replaceAll("_", " ")}
            {alert.details?.length ? ` · ${alert.details.join(" · ")}` : ""}
          </p>
        ))}
        {selected.ads &&
          selected.shop &&
          !selected.adsError &&
          !selected.shopError && (
            <p className="muted">
              Both sources have synced. Campaign details and product reporting
              warnings appear below.
            </p>
          )}
      </section>
      <StoreProducts
        key={`${selected.id}:${from}:${to}`}
        canAssign={!!onEdit}
        store={selected}
        demo={demo}
        from={from}
        to={to}
      />
      <h3>Current daily budgets</h3>
      <p className="muted">
        Fetched with the report. These may differ from the budget that applied
        on the selected day.
      </p>
      {selected.ads?.budgets.length ? (
        selected.ads.budgets.map((b) => (
          <div className="budget-row" key={b.id}>
            <div>
              <strong>{b.name}</strong>
              <small>{b.campaigns.join(" · ")}</small>
              {b.shared && (
                <span className="subtle-tag">Shared · shown once</span>
              )}
            </div>
            <strong>
              {b.period === "DAILY"
                ? formatMoney(b.amount, selected.ads?.currency)
                : "Non-daily budget"}
            </strong>
          </div>
        ))
      ) : (
        <p className="muted">
          Budgets appear after the first successful Google Ads sync.
        </p>
      )}
      <h3>Source details</h3>
      {[
        { title: "Google Ads", r: selected.ads },
        { title: "Shopify", r: selected.shop },
      ].map(({ title, r }) => (
        <div className="source-detail" key={title}>
          <strong>{title}</strong>
          <span>{r ? `${r.currency} · ${r.timezone}` : "Not synced"}</span>
          <small>
            Report date: {r?.date || "—"} · Updated:{" "}
            {r?.fetchedAt
              ? new Date(r.fetchedAt).toLocaleString("en-IN")
              : "Not synced"}
          </small>
        </div>
      ))}
      {selected.ads &&
        selected.shop &&
        (selected.ads.currency !== selected.shop.currency ||
          selected.ads.timezone !== selected.shop.timezone) && (
          <p className="form-error">
            These sources use different currencies or time zones. Figures are
            shown unchanged.
          </p>
        )}
      <p className="detail-note">
        <Info size={15} />
        {selected.ads?.costNote ||
          "Cost per purchase is shown only when available as a purchase-only source metric."}
      </p>
      {!demo && (
        <div className="external-links">
          <a
            href={`https://ads.google.com/aw/overview`}
            target="_blank"
            rel="noreferrer"
          >
            Google Ads
            <ArrowUpRight size={13} />
          </a>
          <a
            href={`https://${selected.domain}/admin`}
            target="_blank"
            rel="noreferrer"
          >
            Shopify admin
            <ArrowUpRight size={13} />
          </a>
        </div>
      )}
    </div>
  );
}
