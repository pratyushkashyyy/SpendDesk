"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  Search,
  Package,
  ChevronDown,
  Link2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/reporting";
import { matchProduct, productRows } from "@/lib/product-matching";
import type { CampaignDetail, Store, StoreProductsData } from "@/lib/types";
const value = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);
function example(store: Store, date: string): StoreProductsData {
  const campaigns: CampaignDetail[] = (store.ads?.campaigns || []).map((c) => ({
    ...c,
    channel: "PERFORMANCE_MAX",
    clicks: 42,
    impressions: 2200,
    conversions: 3,
    budget: store.ads?.budgets.find((b) => b.id === c.budgetId)?.amount || null,
    budgetPeriod: "DAILY",
    sharedBudget: false,
  }));
  const products = [1, 2].map((n) => ({
    id: `gid://shopify/Product/${n}`,
    title: n === 1 ? "Everyday essentials" : "Premium collection",
    handle: `example-${n}`,
    status: "ACTIVE",
    image: null,
    variants: [
      {
        id: `gid://shopify/ProductVariant/${n * 10}`,
        title: "Default",
        sku: `EXAMPLE-${n}`,
        price: n === 1 ? "799.00" : "1299.00",
      },
    ],
  }));
  return {
    products,
    campaigns,
    performance: campaigns.map((c, i) => ({
      itemId: `shopify_IN_${(i % 2) + 1}_${((i % 2) + 1) * 10}`,
      title: products[i % 2].title,
      campaignId: c.id,
      spend: c.spend,
      clicks: c.clicks,
      impressions: c.impressions,
      conversions: c.conversions,
    })),
    links: [],
    date,
    currency: store.ads?.currency || "INR",
    timezone: store.ads?.timezone || "Asia/Kolkata",
    catalogError: null,
    adsError: null,
    fetchedAt: new Date().toISOString(),
  };
}
function CampaignCard({
  campaign: c,
  currency,
}: {
  campaign: CampaignDetail;
  currency: string;
}) {
  return (
    <div className="product-campaign">
      <div className="product-campaign-title">
        <strong>{c.name}</strong>
        <span className="subtle-tag">{c.status.toLowerCase()}</span>
      </div>
      <p className="muted">
        {c.channel.replaceAll("_", " ").toLowerCase()} · Campaign ID {c.id}
      </p>
      <div className="product-stats">
        <span>
          Campaign spend<strong>{formatMoney(c.spend, currency)}</strong>
        </span>
        <span>
          Daily budget
          <strong>
            {c.budgetPeriod === "DAILY"
              ? formatMoney(c.budget, currency)
              : c.budgetPeriod || "—"}
          </strong>
        </span>
        <span>
          Clicks<strong>{value(c.clicks)}</strong>
        </span>
        <span>
          Impressions<strong>{value(c.impressions)}</strong>
        </span>
        <span>
          Conversions<strong>{value(c.conversions)}</strong>
        </span>
      </div>
      {c.sharedBudget && (
        <small className="muted">
          Shared budget · also used by other campaigns
        </small>
      )}
    </div>
  );
}
export default function StoreProducts({
  store,
  from,
  to,
  demo,
}: {
  store: Store;
  from: string;
  to: string;
  demo: boolean;
}) {
  const [data, setData] = useState<StoreProductsData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState("products"),
    [saving, setSaving] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(
    async (force = false, signal?: AbortSignal) => {
      const request = ++sequence.current;
      setLoading(true);
      setError("");
      try {
        if (demo) {
          setData(example(store, from === to ? from : `${from} – ${to}`));
          return;
        }
        const url = `/api/store-products?id=${encodeURIComponent(store.id)}&from=${from}&to=${to}`;
        const res = await fetch(
          force ? "/api/store-products" : url,
          force
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: store.id,
                  from,
                  to,
                  action: "refresh",
                }),
                signal,
              }
            : { signal },
        );
        if (res.status === 401) {
          window.location.assign("/login");
          return;
        }
        const body = await res.json();
        if (request !== sequence.current) return;
        if (!res.ok) throw Error(body.error);
        setData(body);
      } catch (e) {
        if (request === sequence.current && !signal?.aborted)
          setError((e as Error).message);
      } finally {
        if (request === sequence.current) setLoading(false);
      }
    },
    [store.id, from, to, demo],
  );
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setSearch("");
    load(false, controller.signal);
    return () => {
      controller.abort();
      sequence.current++;
    };
  }, [load]);
  async function save(
    productId: string,
    campaignId: string,
    action: "link" | "unlink",
  ) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/store-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: store.id,
          from,
          to,
          productId,
          campaignId,
          action,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw Error(body.error);
      setData((old) =>
        old
          ? {
              ...old,
              links:
                action === "link"
                  ? [
                      ...old.links.filter(
                        (l) =>
                          !(
                            l.productId === productId &&
                            l.campaignId === campaignId
                          ),
                      ),
                      { productId, campaignId },
                    ]
                  : old.links.filter(
                      (l) =>
                        !(
                          l.productId === productId &&
                          l.campaignId === campaignId
                        ),
                    ),
            }
          : old,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const unmatched =
    data?.performance.filter((r) => !matchProduct(r.itemId, data.products)) ||
    [];
  const products =
    data?.products.filter((p) =>
      `${p.title} ${p.variants.map((v) => v.sku).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  return (
    <section
      className="store-products"
      aria-label="Store products and campaigns"
    >
      <div className="products-heading">
        <div>
          <p className="eyebrow">PRODUCT WORKSPACE</p>
          <h3>Products & campaigns</h3>
          <p className="muted">
            {from === to ? from : `${from} – ${to}`} ·{" "}
            {data?.timezone || store.ads?.timezone || "Account time zone"}
            {demo ? " · Example data" : ""}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={loading || demo}
          onClick={() => load(true)}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          Refresh products
        </Button>
      </div>
      <div
        className="product-tabs"
        role="tablist"
        aria-label="Product workspace"
      >
        <button
          role="tab"
          aria-selected={tab === "products"}
          onClick={() => setTab("products")}
        >
          Products{data ? ` (${data.products.length})` : ""}
        </button>
        <button
          role="tab"
          aria-selected={tab === "campaigns"}
          onClick={() => setTab("campaigns")}
        >
          All campaigns{data ? ` (${data.campaigns.length})` : ""}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="products-loading">
          <RefreshCw size={16} className="spin" />
          Loading this store’s products and campaigns…
        </p>
      )}
      {data && (
        <>
          <div className="product-source-note">
            {data.catalogError && (
              <p className="form-error">
                {data.catalogError}{" "}
                {data.products.length > 0
                  ? "Showing the last successful catalog."
                  : ""}
              </p>
            )}
            {data.adsError && (
              <p className="form-error">
                {data.adsError}{" "}
                {data.campaigns.length > 0
                  ? "Showing the last successful campaign report."
                  : ""}
              </p>
            )}
          </div>
          {tab === "products" ? (
            <>
              <label className="product-search">
                <Search size={15} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products or SKU"
                  aria-label="Search products or SKU"
                />
              </label>
              <p className="muted product-explainer">
                Expand a product to see its reported advertising activity.
                Assign campaigns when a product link isn’t reported. Conversions
                include all conversion types.
              </p>
              {products.map((p) => {
                const rows = productRows(p.id, data.products, data.performance);
                const automatic = [...new Set(rows.map((r) => r.campaignId))];
                const manual = data.links
                  .filter((l) => l.productId === p.id)
                  .map((l) => l.campaignId);
                const ids = [...new Set([...automatic, ...manual])];
                return (
                  <details className="product-card" key={p.id}>
                    <summary>
                      {p.image ? (
                        <img
                          className="product-image"
                          src={p.image}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="product-image">
                          <Package size={22} />
                        </div>
                      )}
                      <div className="product-summary">
                        <strong>{p.title}</strong>
                        <small>
                          {p.status.toLowerCase()} · {p.variants.length}{" "}
                          {p.variants.length === 1 ? "variant" : "variants"} ·{" "}
                          {ids.length} linked{" "}
                          {ids.length === 1 ? "campaign" : "campaigns"}
                        </small>
                      </div>
                      <ChevronDown size={16} />
                    </summary>
                    <div className="product-body">
                      <div className="variant-list">
                        {p.variants.map((v) => (
                          <span key={v.id}>
                            {v.title === "Default Title" ? "Standard" : v.title}
                            {v.sku ? ` · ${v.sku}` : ""} · {v.price} (store
                            currency)
                          </span>
                        ))}
                      </div>
                      <a
                        href={`https://${store.domain}/products/${encodeURIComponent(p.handle)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View product ↗
                      </a>
                      {!ids.length && (
                        <p className="muted">
                          No product-to-campaign link for this date. You can
                          assign a campaign below.
                        </p>
                      )}
                      {ids.map((id) => {
                        const c = data.campaigns.find((c) => c.id === id);
                        return (
                          <div key={id} className="linked-campaign">
                            <div className="link-origin">
                              <span>
                                <Link2 size={12} />
                                {automatic.includes(id)
                                  ? "Reported product link"
                                  : "Manually assigned"}
                              </span>
                              {manual.includes(id) && !demo && (
                                <button
                                  disabled={saving}
                                  aria-label={`Remove ${c?.name || id} from ${p.title}`}
                                  onClick={() => save(p.id, id, "unlink")}
                                >
                                  <X size={13} />
                                  Remove assignment
                                </button>
                              )}
                            </div>
                            {c ? (
                              <CampaignCard
                                campaign={c}
                                currency={data.currency}
                              />
                            ) : (
                              <p>
                                Campaign {id} is no longer in the current
                                campaign list.
                              </p>
                            )}
                            {rows
                              .filter((r) => r.campaignId === id)
                              .map((r, i) => (
                                <div
                                  className="product-performance"
                                  key={`${r.itemId}-${i}`}
                                >
                                  <small>Product report · {r.itemId}</small>
                                  <div className="product-stats">
                                    <span>
                                      Product spend
                                      <strong>
                                        {formatMoney(r.spend, data.currency)}
                                      </strong>
                                    </span>
                                    <span>
                                      Product clicks
                                      <strong>{value(r.clicks)}</strong>
                                    </span>
                                    <span>
                                      Impressions
                                      <strong>{value(r.impressions)}</strong>
                                    </span>
                                    <span>
                                      Conversions
                                      <strong>{value(r.conversions)}</strong>
                                    </span>
                                  </div>
                                </div>
                              ))}
                            {manual.includes(id) && !automatic.includes(id) && (
                              <p className="muted">
                                Figures above are for the whole campaign. Google
                                did not report product-level figures for this
                                link.
                              </p>
                            )}
                          </div>
                        );
                      })}
                      {!demo && (
                        <label className="campaign-assignment">
                          Assign another campaign
                          <select
                            aria-label={`Assign campaign to ${p.title}`}
                            value=""
                            disabled={saving || loading || !!data.adsError}
                            onChange={(e) => {
                              if (e.target.value)
                                save(p.id, e.target.value, "link");
                            }}
                          >
                            <option value="">Choose a campaign…</option>
                            {data.campaigns
                              .filter((c) => !ids.includes(c.id))
                              .map((c) => (
                                <option value={c.id} key={c.id}>
                                  {c.name} ({c.status.toLowerCase()})
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                    </div>
                  </details>
                );
              })}
              {!products.length && (
                <p className="muted">
                  {search
                    ? "No products match your search."
                    : data.catalogError
                      ? "Products will appear once catalog access is available."
                      : "This store has no products."}
                </p>
              )}
              {unmatched.length > 0 && (
                <details className="unmatched-products">
                  <summary>
                    Unmatched advertised items ({unmatched.length})
                  </summary>
                  <p className="muted">
                    These feed item IDs do not uniquely match a Shopify product
                    or SKU. They are kept separate.
                  </p>
                  {unmatched.map((r, i) => (
                    <div className="product-performance" key={i}>
                      <strong>{r.title}</strong>
                      <small>
                        {r.itemId} ·{" "}
                        {data.campaigns.find((c) => c.id === r.campaignId)
                          ?.name || r.campaignId}
                      </small>
                      <div className="product-stats">
                        <span>
                          Product spend
                          <strong>{formatMoney(r.spend, data.currency)}</strong>
                        </span>
                        <span>
                          Conversions<strong>{value(r.conversions)}</strong>
                        </span>
                      </div>
                    </div>
                  ))}
                </details>
              )}
            </>
          ) : (
            <>
              <p className="muted product-explainer">
                Whole-campaign figures for{" "}
                {from === to ? from : `${from} – ${to}`}. Budgets are current
                settings.
              </p>
              {data.campaigns.map((c) => (
                <CampaignCard
                  campaign={c}
                  currency={data.currency}
                  key={c.id}
                />
              ))}
              {!data.campaigns.length && (
                <p className="muted">
                  {data.adsError
                    ? "Campaigns will appear once Google Ads access is available."
                    : "No campaigns returned for this account."}
                </p>
              )}
            </>
          )}
          <small className="products-checked">
            Checked {new Date(data.fetchedAt).toLocaleString()} · Reports are
            cached for one hour.
          </small>
        </>
      )}
    </section>
  );
}
