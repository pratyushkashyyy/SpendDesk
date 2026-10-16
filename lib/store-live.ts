import { dateInZone } from "./reporting";
import type { AdsReport, ShopReport, StoreLive, OrderFlow } from "./types";
export type LiveRow = {
  store_id: string;
  source: string;
  report_date: string;
  payload: any;
  error?: string | null;
  observed_at?: Date | string;
};
const timestamp = (row: LiveRow) => Date.parse(row.payload?.fetchedAt || "");
const clean = (payload: any) =>
  payload
    ? Object.fromEntries(
        Object.entries(payload).filter(([key]) => key !== "raw"),
      )
    : null;
const localSeconds = (time: number, zone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(time);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  return get("hour") * 3600 + get("minute") * 60 + get("second");
};
// Hourly jobs drift slightly as stores are processed. Match within 15 minutes,
// expose both timestamps, and never interpolate a full-day total into a pace.
function closest(
  rows: LiveRow[],
  distance: (row: LiveRow) => number,
  tolerance: number,
) {
  return rows
    .filter((row) => {
      if (!row.payload || !Number.isFinite(timestamp(row))) return false;
      try {
        return (
          dateInZone(row.payload.timezone, 0, new Date(timestamp(row))) ===
          row.report_date
        );
      } catch {
        return false;
      }
    })
    .map((row) => ({ row, distance: distance(row) }))
    .filter((candidate) => candidate.distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)[0]?.row;
}
export function buildStoreLive(
  storeId: string,
  reports: LiveRow[],
  observations: LiveRow[],
  connected: boolean,
  now = new Date(),
): StoreLive {
  const current: Record<string, LiveRow | undefined> = {};
  const previous: Record<string, LiveRow | undefined> = {};
  for (const source of ["ads", "shop"]) {
    const rows = reports.filter(
      (row) => row.store_id === storeId && row.source === source,
    );
    const latest = rows
      .filter((row) => row.payload)
      .sort((a, b) => timestamp(b) - timestamp(a))[0];
    const zone = latest?.payload?.timezone || "Asia/Kolkata";
    current[source] = rows.find(
      (row) => row.report_date === dateInZone(zone, 0, now),
    );
    const live = current[source];
    if (!live?.payload) continue;
    const target = timestamp(live) - 3600000;
    previous[source] = closest(
      observations.filter(
        (row) =>
          row.store_id === storeId &&
          row.source === source &&
          row.report_date === live.report_date &&
          row.payload.timezone === zone,
      ),
      (row) => Math.abs(timestamp(row) - target),
      15 * 60000,
    );
  }
  const shop = current.shop;
  const todayOrders = shop?.payload?.orders ?? null;
  const flow: OrderFlow = {
    state: "no_baseline",
    todayOrders,
    yesterdayOrders: null,
    percent: null,
    asOf: shop?.payload?.fetchedAt || null,
    baselineAt: null,
    hourlyDelta: null,
  };
  const hourlyOrders = previous.shop?.payload?.orders;
  if (todayOrders != null && hourlyOrders != null)
    flow.hourlyDelta = todayOrders - hourlyOrders;
  if (!connected) flow.state = "not_connected";
  else if (!shop?.payload || todayOrders == null) flow.state = "unavailable";
  else if (
    shop.error ||
    !Number.isFinite(timestamp(shop)) ||
    now.getTime() - timestamp(shop) > 90 * 60000 ||
    timestamp(shop) > now.getTime() + 5 * 60000
  )
    flow.state = "stale";
  else {
    const zone = shop.payload.timezone;
    const yesterday = dateInZone(zone, -1, new Date(timestamp(shop)));
    const baseline = closest(
      observations.filter(
        (row) =>
          row.store_id === storeId &&
          row.source === "shop" &&
          row.report_date === yesterday &&
          row.payload.timezone === zone &&
          row.payload.orders != null,
      ),
      (row) =>
        Math.abs(
          localSeconds(timestamp(row), zone) -
            localSeconds(timestamp(shop), zone),
        ) * 1000,
      15 * 60000,
    );
    if (baseline) {
      const orders = baseline.payload.orders as number;
      flow.yesterdayOrders = orders;
      flow.baselineAt = baseline.payload.fetchedAt;
      flow.percent =
        orders > 0 ? ((todayOrders - orders) / orders) * 100 : null;
      flow.state =
        todayOrders === 0 && orders === 0
          ? "quiet"
          : orders === 0 || todayOrders > orders * 1.2
            ? "ahead"
            : todayOrders < orders * 0.8
              ? "slower"
              : "on_pace";
    }
  }
  const zone = shop?.payload?.timezone || "Asia/Kolkata";
  const today = dateInZone(zone, 0, now);
  const yesterdayDate = dateInZone(zone, -1, now);
  const history = new Map<
    string,
    { date: string; at: string; orders: number; minute: number }
  >();
  for (const row of [...observations, ...(shop?.payload ? [shop] : [])]) {
    if (
      row.store_id !== storeId ||
      row.source !== "shop" ||
      row.payload?.timezone !== zone ||
      ![today, yesterdayDate].includes(row.report_date) ||
      !Number.isFinite(row.payload?.orders) ||
      row.payload.orders < 0 ||
      !Number.isFinite(timestamp(row)) ||
      timestamp(row) > now.getTime() + 5 * 60000
    )
      continue;
    if (dateInZone(zone, 0, new Date(timestamp(row))) !== row.report_date)
      continue;
    history.set(row.payload.fetchedAt, {
      date: row.report_date,
      at: row.payload.fetchedAt,
      orders: row.payload.orders,
      minute: localSeconds(timestamp(row), zone) / 60,
    });
  }
  return {
    orderHistory: [...history.values()].sort(
      (a, b) => Date.parse(a.at) - Date.parse(b.at),
    ),
    today: {
      ads: clean(current.ads?.payload) as AdsReport | null,
      shop: clean(shop?.payload) as ShopReport | null,
      adsError: current.ads?.error || null,
      shopError: shop?.error || null,
    },
    hourAgo: {
      ads: clean(previous.ads?.payload) as AdsReport | null,
      shop: clean(previous.shop?.payload) as ShopReport | null,
      adsError: null,
      shopError: null,
    },
    orderFlow: flow,
  };
}

// Today uses the change between actual hourly snapshots, independently of
// whether yesterday's same-time baseline exists. Never label stale data healthy.
export function hourlyOrderFlow(live?: StoreLive) {
  const flow = live?.orderFlow;
  const blocked =
    flow?.state === "stale" ||
    flow?.state === "unavailable" ||
    flow?.state === "not_connected";
  if (!flow || blocked)
    return {
      state: flow?.state || "unavailable",
      label:
        flow?.state === "stale"
          ? "Needs refresh"
          : flow?.state === "not_connected"
            ? "Not connected"
            : "Unavailable",
      delta: null,
      minutes: null,
    };
  const previous = live?.hourAgo.shop;
  const current = live?.today.shop;
  const minutes =
    previous && current
      ? Math.round(
          (Date.parse(current.fetchedAt) - Date.parse(previous.fetchedAt)) /
            60000,
        )
      : null;
  if (
    !previous ||
    !current ||
    flow.hourlyDelta == null ||
    minutes == null ||
    minutes < 45 ||
    minutes > 75
  )
    return {
      state: "no_baseline",
      label: "Previous hour missing",
      delta: null,
      minutes: null,
    };
  return {
    state:
      flow.hourlyDelta > 0
        ? "on_pace"
        : flow.hourlyDelta < 0
          ? "stale"
          : "quiet",
    label:
      flow.hourlyDelta > 0
        ? "Orders coming in"
        : flow.hourlyDelta < 0
          ? "Count adjusted"
          : "No new orders",
    delta: flow.hourlyDelta,
    minutes,
  };
}
