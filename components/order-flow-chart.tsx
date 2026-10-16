"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OrderChartData } from "@/lib/order-chart";
const count = (value: number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(
        value,
      );
export const chartDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export const chartRange = (from: string, to: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatRange(new Date(`${from}T12:00:00Z`), new Date(`${to}T12:00:00Z`));
const clock = (minute: number) =>
  minute === 1440
    ? "24:00"
    : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;
export default function OrderFlowChart({ data }: { data: OrderChartData }) {
  const { points, mode } = data;
  if (
    !points.some((point) => point.current != null || point.comparison != null)
  )
    return (
      <div className="flow-chart-empty">
        No saved order figures for these dates yet.
      </div>
    );
  const highest = Math.max(
    0,
    ...points.flatMap((p) => [p.current ?? 0, p.comparison ?? 0]),
  );
  const scale = 10 ** Math.floor(Math.log10(Math.max(highest, 2)));
  const maximum = Math.max(
    2,
    ([1, 2, 5, 10].find((step) => step >= highest / scale) || 10) * scale,
  );
  const stride = Math.max(1, Math.ceil((points.length - 1) / 6));
  const ticks =
    mode === "intraday"
      ? [0, 360, 720, 1080, 1440]
      : [
          ...new Set([
            ...points.filter((_, i) => i % stride === 0).map((p) => p.x),
            points.at(-1)!.x,
          ]),
        ];
  const tick = (x: number) =>
    mode === "intraday"
      ? clock(x)
      : points[x]?.currentDate
        ? new Date(`${points[x].currentDate}T12:00:00Z`).toLocaleDateString(
            "en-US",
            { timeZone: "UTC", month: "short", day: "numeric" },
          )
        : "";
  return (
    <div
      className="flow-chart shopify-order-chart"
      role="img"
      aria-label={
        mode === "intraday"
          ? "Today and comparison cumulative orders by local time"
          : "Orders per day for the selected and comparison periods"
      }
    >
      <ResponsiveContainer width="100%" height={310} minWidth={0}>
        <LineChart
          data={points}
          margin={{ top: 18, right: 16, bottom: 10, left: -14 }}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} stroke="#e7ebed" />
          <XAxis
            dataKey="x"
            type="number"
            domain={
              mode === "intraday"
                ? [0, 1440]
                : [0, Math.max(points.length - 1, 1)]
            }
            ticks={ticks}
            tickFormatter={tick}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#727b80" }}
            dy={8}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, maximum]}
            ticks={[0, maximum / 2, maximum]}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#727b80" }}
          />
          <Tooltip
            cursor={{ stroke: "#cbd6dc", strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload;
              const percent =
                point.current != null && point.comparison > 0
                  ? ((point.current - point.comparison) / point.comparison) *
                    100
                  : null;
              const stamp = (date: string | null, at: string | null) =>
                date
                  ? `${chartDate(date)}${mode === "intraday" && at ? ` · ${new Date(at).toLocaleTimeString("en-IN", { timeZone: data.timezone, hour: "2-digit", minute: "2-digit" })}` : ""}`
                  : "No matching update";
              return (
                <div className="flow-chart-tooltip shopify-chart-tooltip">
                  <strong>Orders</strong>
                  <span>
                    <i className="tooltip-series-current" />
                    {stamp(point.currentDate, point.currentAt)}
                  </span>
                  <b>{count(point.current)}</b>
                  {percent != null && (
                    <small>
                      {percent < 0 ? "↘" : "↗"} {count(Math.abs(percent))}% from
                      comparison
                    </small>
                  )}
                  <span>
                    <i className="tooltip-series-comparison" />
                    {stamp(point.comparisonDate, point.comparisonAt)}
                  </span>
                  <b>{count(point.comparison)}</b>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            name="Comparison"
            dataKey="comparison"
            stroke="#8ab7c9"
            strokeDasharray="3 6"
            strokeLinecap="round"
            strokeWidth={2}
            dot={
              points.filter((p) => p.comparison != null).length === 1
                ? { r: 3 }
                : false
            }
            activeDot={{ r: 5, stroke: "white", strokeWidth: 2 }}
            connectNulls={mode === "intraday"}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            name="Selected period"
            dataKey="current"
            stroke="#2996c1"
            strokeLinecap="round"
            strokeWidth={2.5}
            dot={
              points.filter((p) => p.current != null).length === 1
                ? { r: 3 }
                : false
            }
            activeDot={{ r: 5, stroke: "white", strokeWidth: 2 }}
            connectNulls={mode === "intraday"}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
