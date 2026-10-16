"use client";
import { useEffect, useState } from "react";
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import DateRangeFilter from "@/components/date-range-filter";
import OrderFlowChart, { chartRange } from "@/components/order-flow-chart";
import type { Store } from "@/lib/types";
import type { ReportSelection } from "@/lib/report-selection";
import { buildOrderChart, type OrderChartData } from "@/lib/order-chart";
import { dateInZone } from "@/lib/reporting";
import { hourlyOrderFlow } from "@/lib/store-live";
const count = (value: number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(
        value,
      );
export default function OrderFlowDetails({
  store,
  range,
  hourAgo,
  demo = false,
}: {
  store: Store;
  range?: ReportSelection;
  hourAgo: boolean;
  demo?: boolean;
}) {
  const zone =
    store.live?.today.shop?.timezone || store.shop?.timezone || "Asia/Kolkata";
  const today = store.live?.today.shop?.date || dateInZone(zone);
  const [selection, setSelection] = useState<ReportSelection>(() =>
    range && range.from !== range.to
      ? range
      : { period: "today", from: today, to: today },
  );
  const [comparison, setComparison] = useState<"period" | "month">(
    selection.period === "monthToDate" ? "month" : "period",
  );
  const [data, setData] = useState<OrderChartData | null>(null),
    [error, setError] = useState("");
  const hourly = hourlyOrderFlow(store.live);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    async function load() {
      try {
        if (demo) {
          const observations = (store.live?.orderHistory || []).map(
            (point) => ({
              report_date: point.date,
              payload: {
                date: point.date,
                fetchedAt: point.at,
                orders: point.orders,
                timezone: zone,
              },
            }),
          );
          setData(
            buildOrderChart(
              selection.from,
              selection.to,
              comparison,
              zone,
              [],
              observations,
            ),
          );
          return;
        }
        const res = await fetch(
          `/api/order-chart?id=${encodeURIComponent(store.id)}&from=${selection.from}&to=${selection.to}&comparison=${comparison}`,
          { signal: controller.signal },
        );
        if (res.status === 401) {
          window.location.assign("/login");
          return;
        }
        const body = await res.json();
        if (!res.ok) throw Error(body.error || "Could not load saved orders.");
        if (!controller.signal.aborted) setData(body);
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      }
    }
    load();
    return () => controller.abort();
  }, [store.id, selection.from, selection.to, comparison, demo, zone]);
  const stamp = (date: string | null, at: string | null) =>
    at
      ? new Date(at).toLocaleString("en-IN", {
          timeZone: data?.timezone || zone,
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : date || "—";
  return (
    <DialogContent
      className="order-flow-dialog shopify-order-dialog"
      onClick={(event) => event.stopPropagation()}
    >
      <DialogHeader>
        <DialogTitle>{store.name} · Order flow</DialogTitle>
        <DialogDescription>
          {data?.timezone || zone}
          {demo ? " · Example data" : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="order-chart-controls">
        <DateRangeFilter
          period={selection.period}
          from={selection.from}
          to={selection.to}
          onApply={(period, from, to) => {
            setSelection({ period, from, to });
            setComparison(period === "monthToDate" ? "month" : "period");
          }}
        />
        <label>
          <span>Compare with</span>
          <select
            aria-label="Compare orders with"
            value={comparison}
            onChange={(event) =>
              setComparison(event.target.value as "period" | "month")
            }
          >
            <option value="period">Previous period</option>
            <option value="month">Previous month</option>
          </select>
        </label>
      </div>
      <div className="shopify-chart-metric">
        <strong>{count(data?.total)}</strong>
        <span>
          {data?.percent != null
            ? `${data.percent > 0 ? "+" : ""}${count(data.percent)}%`
            : "—"}
        </span>
      </div>
      <div className="shopify-chart-copy">
        <h3>Orders over time</h3>
        <p>
          {data?.mode === "intraday"
            ? "Cumulative orders at saved update times"
            : "Number of orders across all sales channels"}
        </p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : data ? (
        <OrderFlowChart data={data} />
      ) : (
        <div className="flow-chart-empty" role="status">
          Loading order chart…
        </div>
      )}
      {data && (
        <div className="shopify-chart-legend">
          <span>
            <i className="tooltip-series-current" />
            {chartRange(data.from, data.to)}
          </span>
          <span>
            <i className="tooltip-series-comparison" />
            {chartRange(data.comparisonFrom, data.comparisonTo)}
          </span>
        </div>
      )}
      {hourAgo &&
        selection.from === today &&
        selection.to === today &&
        hourly.delta != null && (
          <p className="chart-hourly-context">
            Previous hour: {count(store.live?.hourAgo.shop?.orders)} →{" "}
            {count(store.live?.orderFlow.todayOrders)} ·{" "}
            <strong>
              {hourly.delta > 0 ? "+" : ""}
              {count(hourly.delta)} orders in {hourly.minutes} min
            </strong>
          </p>
        )}
      {hourAgo &&
        selection.from === today &&
        selection.to === today &&
        hourly.state === "no_baseline" && (
          <p className="flow-chart-notice">
            No snapshot 45–75 minutes before the latest update. Hourly syncs
            collect this comparison history.
          </p>
        )}
      {data && (data.missingCurrent > 0 || data.missingComparison > 0) && (
        <p className="flow-chart-notice">
          {data.mode === "intraday"
            ? "No matching saved updates for part of this comparison. Intraday history builds as reports sync."
            : `${data.missingCurrent} selected-day and ${data.missingComparison} comparison-day reports are unavailable. Refresh those dates to prepare missing reports.`}{" "}
          Missing figures are not treated as zero.
        </p>
      )}
      {data?.errors.length ? (
        <p className="flow-chart-notice">
          Latest source refresh: {data.errors.join(" · ")}
        </p>
      ) : null}
      {store.live?.orderFlow.state === "stale" && selection.from === today && (
        <p className="flow-chart-notice">
          Today's saved Shopify update is over 90 minutes old or its latest
          refresh failed.
        </p>
      )}
      <p className="flow-chart-note">
        {data?.mode === "intraday"
          ? "Saved updates are compared within 15 minutes of the same local time. Reporting adjustments can affect cumulative counts."
          : "Daily saved totals. Today's figures may still be incomplete."}
      </p>
      {!!data?.points.length && (
        <details className="flow-chart-data">
          <summary>View saved data</summary>
          <div>
            <table>
              <thead>
                <tr>
                  <th>Selected period</th>
                  <th>Orders</th>
                  <th>Comparison</th>
                  <th>Orders</th>
                </tr>
              </thead>
              <tbody>
                {data.points.map((point) => (
                  <tr key={point.x}>
                    <td>{stamp(point.currentDate, point.currentAt)}</td>
                    <td>{count(point.current)}</td>
                    <td>{stamp(point.comparisonDate, point.comparisonAt)}</td>
                    <td>{count(point.comparison)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </DialogContent>
  );
}
