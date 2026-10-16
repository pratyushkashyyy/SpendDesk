import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStoreLive,
  hourlyOrderFlow,
  type LiveRow,
} from "../lib/store-live";
const now = new Date("2026-10-16T06:05:00Z"); // 11:35 India
const report = (
  date: string,
  at: string,
  orders: number | null,
  source = "shop",
  zone = "Asia/Kolkata",
): LiveRow => ({
  store_id: "store",
  source,
  report_date: date,
  payload: {
    date,
    timezone: zone,
    orders,
    spend: orders,
    currency: "INR",
    fetchedAt: at,
    raw: { private: true },
  },
});
const current = report("2026-10-16", "2026-10-16T06:00:00Z", 80);
const yesterday = report("2026-10-15", "2026-10-15T06:00:00Z", 100);
test("order flow compares same-time snapshots, never yesterday's full-day total", () => {
  const result = buildStoreLive(
    "store",
    [current, report("2026-10-15", "2026-10-16T05:00:00Z", 900)],
    [yesterday],
    true,
    now,
  );
  assert.equal(result.orderFlow.state, "on_pace");
  assert.equal(result.orderFlow.percent, -20);
  assert.equal(result.orderFlow.yesterdayOrders, 100);
  assert.equal(result.today.shop!.orders, 80);
  assert.equal("raw" in result.today.shop!, false);
});
test("flow thresholds handle slower, ahead, genuine zero, and unavailable baseline", () => {
  for (const [today, expected] of [
    [79, "slower"],
    [120, "on_pace"],
    [121, "ahead"],
  ] as const)
    assert.equal(
      buildStoreLive(
        "store",
        [{ ...current, payload: { ...current.payload, orders: today } }],
        [yesterday],
        true,
        now,
      ).orderFlow.state,
      expected,
    );
  const zero = report("2026-10-15", "2026-10-15T06:00:00Z", 0);
  assert.equal(
    buildStoreLive("store", [current], [zero], true, now).orderFlow.state,
    "ahead",
  );
  assert.equal(
    buildStoreLive(
      "store",
      [{ ...current, payload: { ...current.payload, orders: 0 } }],
      [zero],
      true,
      now,
    ).orderFlow.state,
    "quiet",
  );
  assert.equal(
    buildStoreLive("store", [current], [], true, now).orderFlow.state,
    "no_baseline",
  );
});
test("current view compares a same-day snapshot about an hour before the latest source update", () => {
  const before = report("2026-10-16", "2026-10-16T05:02:00Z", 60);
  const tooOld = report("2026-10-16", "2026-10-16T04:00:00Z", 20);
  const other = { ...before, store_id: "other" };
  const result = buildStoreLive(
    "store",
    [current],
    [tooOld, other, before, yesterday],
    true,
    now,
  );
  assert.equal(result.hourAgo.shop!.orders, 60);
  assert.equal(result.orderFlow.hourlyDelta, 20);
  assert.equal(
    buildStoreLive("store", [current], [tooOld], true, now).hourAgo.shop,
    null,
  );
});
test("missing, stale and failed reports do not produce a healthy flow indicator", () => {
  assert.equal(
    buildStoreLive("store", [], [], false, now).orderFlow.state,
    "not_connected",
  );
  assert.equal(
    buildStoreLive("store", [], [], true, now).orderFlow.state,
    "unavailable",
  );
  assert.equal(
    buildStoreLive(
      "store",
      [{ ...current, error: "Refresh failed" }],
      [yesterday],
      true,
      now,
    ).orderFlow.state,
    "stale",
  );
  assert.equal(
    buildStoreLive(
      "store",
      [current],
      [yesterday],
      true,
      new Date("2026-10-16T08:00:00Z"),
    ).orderFlow.state,
    "stale",
  );
});
test("source time zones, DST and midnight do not mix calendar days or invent hourly baselines", () => {
  const zone = "America/New_York";
  const today = report("2026-11-01", "2026-11-01T16:30:00Z", 70, "shop", zone); // 11:30 EST
  const baseline = report(
    "2026-10-31",
    "2026-10-31T15:30:00Z",
    100,
    "shop",
    zone,
  ); // 11:30 EDT
  assert.equal(
    buildStoreLive(
      "store",
      [today],
      [baseline],
      true,
      new Date("2026-11-01T16:35:00Z"),
    ).orderFlow.state,
    "slower",
  );
  const midnight = report("2026-10-16", "2026-10-15T18:40:00Z", 1);
  const previousDay = report("2026-10-15", "2026-10-15T17:40:00Z", 999);
  assert.equal(
    buildStoreLive(
      "store",
      [midnight],
      [previousDay],
      true,
      new Date("2026-10-15T18:45:00Z"),
    ).hourAgo.shop,
    null,
  );
  const wrong = report("2026-10-15", "2026-10-16T06:00:00Z", 100);
  assert.equal(
    buildStoreLive("store", [current], [wrong], true, now).orderFlow.state,
    "no_baseline",
  );
});

test("Today flow uses the hourly baseline even without yesterday and suppresses stale changes", () => {
  const before = report("2026-10-16", "2026-10-16T05:02:00Z", 60);
  const live = buildStoreLive("store", [current], [before], true, now);
  assert.equal(live.orderFlow.state, "no_baseline");
  assert.deepEqual(hourlyOrderFlow(live), {
    state: "on_pace",
    label: "Orders coming in",
    delta: 20,
    minutes: 58,
  });
  assert.equal(
    hourlyOrderFlow(buildStoreLive("store", [current], [], true, now)).label,
    "Previous hour missing",
  );
  assert.equal(
    hourlyOrderFlow(
      buildStoreLive(
        "store",
        [{ ...current, error: "Failed" }],
        [before],
        true,
        now,
      ),
    ).delta,
    null,
  );
  const quiet = buildStoreLive(
    "store",
    [current],
    [{ ...before, payload: { ...before.payload, orders: 80 } }],
    true,
    now,
  );
  assert.equal(hourlyOrderFlow(quiet).label, "No new orders");
  const adjusted = buildStoreLive(
    "store",
    [current],
    [{ ...before, payload: { ...before.payload, orders: 81 } }],
    true,
    now,
  );
  assert.equal(hourlyOrderFlow(adjusted).label, "Count adjusted");
});

test("chart history contains only genuine same-day Shopify observations in source local time", () => {
  const before = report("2026-10-16", "2026-10-16T05:02:00Z", 60);
  const backfill = report("2026-10-15", "2026-10-16T05:00:00Z", 900);
  const wrongStore = { ...before, store_id: "other" };
  const ads = { ...before, source: "ads" };
  const future = report("2026-10-16", "2026-10-16T08:00:00Z", 999);
  const live = buildStoreLive(
    "store",
    [current],
    [before, before, yesterday, backfill, wrongStore, ads, future],
    true,
    now,
  );
  assert.deepEqual(
    live.orderHistory?.map((point) => point.orders),
    [100, 60, 80],
  );
  assert.equal(live.orderHistory?.[1].minute, 632); // 10:32 India
  assert.deepEqual(Object.keys(live.orderHistory![0]).sort(), [
    "at",
    "date",
    "minute",
    "orders",
  ]);
});
