"use client";
import { lazy, Suspense, useState } from "react";
import { Minus } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ReportSelection } from "@/lib/report-selection";
import type { Store } from "@/lib/types";
import { formatMoney } from "@/lib/reporting";
import { hourlyOrderFlow } from "@/lib/store-live";
const count = (value: number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
        value,
      );
const stamp = (report: { fetchedAt: string; timezone: string }) =>
  `${new Date(report.fetchedAt).toLocaleString("en-IN", { timeZone: report.timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${report.timezone}`;
export function ComparisonValue({
  store,
  source,
  metric,
  hourAgo,
}: {
  store: Store;
  source: "ads" | "shop";
  metric: "spend" | "orders" | "purchases" | "costPerPurchase";
  hourAgo: boolean;
}) {
  const pair = store.live?.[hourAgo ? "hourAgo" : "today"];
  const report = pair?.[source];
  const label = hourAgo ? "~1h ago" : "Today";
  let value = "—";
  if (metric === "orders") value = count(pair?.shop?.orders);
  else if (metric === "purchases") value = count(pair?.ads?.purchases);
  else value = formatMoney(pair?.ads?.[metric], pair?.ads?.currency);
  const error = pair?.[source === "ads" ? "adsError" : "shopError"];
  const detail = report
    ? `${report.date} · saved ${stamp(report)}${error ? ` · Refresh failed: ${error}` : ""}`
    : hourAgo
      ? "No saved snapshot 45–75 minutes before this source's latest update. Hourly syncs collect this history; historical daily totals cannot replace it."
      : "Today's source report is not available yet.";
  return (
    <small
      className={`comparison-value${error ? " comparison-warning" : ""}`}
      title={detail}
      aria-label={`${label} ${metric}: ${value}`}
    >
      <span>{label}</span>
      <strong>
        {report ? value : "No snapshot"}
        {error ? " *" : ""}
      </strong>
    </small>
  );
}
const OrderFlowDetails = lazy(() => import("./order-flow-details"));
const labels = {
  on_pace: "On pace",
  ahead: "Ahead",
  slower: "Slower",
  quiet: "No orders yet",
  no_baseline: "Yesterday snapshot missing",
  stale: "Needs refresh",
  unavailable: "Unavailable",
  not_connected: "Not connected",
};
export function OrderFlowIndicator({
  store,
  hourAgo,
  range,
  demo = false,
}: {
  store: Store;
  hourAgo: boolean;
  range?: ReportSelection;
  demo?: boolean;
}) {
  const live = store.live;
  const flow = live?.orderFlow;
  const [open, setOpen] = useState(false);
  const hourly = hourlyOrderFlow(live);
  const state = hourAgo ? hourly.state : flow?.state || "unavailable";
  const label = hourAgo ? hourly.label : labels[flow?.state || "unavailable"];
  const compared = flow?.yesterdayOrders != null;
  const delta = hourAgo
    ? hourly.delta
    : compared
      ? flow!.todayOrders! - flow!.yesterdayOrders!
      : null;
  const available =
    !["stale", "unavailable", "not_connected"].includes(
      flow?.state || "unavailable",
    ) && delta != null;
  const direction =
    available && delta! > 0
      ? "up"
      : available && delta! < 0
        ? "down"
        : "neutral";
  return (
    <div
      className="order-flow"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`flow-arrow flow-arrow-${direction}`}
        aria-label={`Order flow for ${store.name}: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${label} · Click to view order chart`}
        onClick={() => setOpen(true)}
      >
        {direction === "neutral" ? (
          <Minus size={20} strokeWidth={2.3} aria-hidden="true" />
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M12 3 3 12h6v9h6v-9h6L12 3Z"
              transform={direction === "down" ? "rotate(180 12 12)" : undefined}
            />
          </svg>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <Suspense
            fallback={
              <DialogContent className="order-flow-dialog">
                <DialogTitle>{store.name} · Order flow</DialogTitle>
                <p role="status">Loading order chart…</p>
              </DialogContent>
            }
          >
            <OrderFlowDetails
              store={store}
              range={range}
              hourAgo={hourAgo}
              demo={demo}
            />
          </Suspense>
        )}
      </Dialog>
    </div>
  );
}
