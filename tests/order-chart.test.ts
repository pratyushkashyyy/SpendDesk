import { test } from "node:test";
import assert from "node:assert/strict";
import { comparisonRange, buildOrderChart } from "../lib/order-chart";
const now = new Date("2026-10-16T07:00:00Z");
const row = (date: string, orders: number, at = `${date}T06:00:00Z`) => ({
  report_date: date,
  payload: { date, orders, timezone: "Asia/Kolkata", fetchedAt: at },
});
test("month-to-date aligns with prior month and clamps short calendar months", () => {
  assert.deepEqual(comparisonRange("2026-10-01", "2026-10-16", "month"), {
    from: "2026-09-01",
    to: "2026-09-16",
  });
  assert.deepEqual(comparisonRange("2028-03-01", "2028-03-31", "month"), {
    from: "2028-02-01",
    to: "2028-02-29",
  });
  assert.deepEqual(comparisonRange("2026-10-10", "2026-10-16", "period"), {
    from: "2026-10-03",
    to: "2026-10-09",
  });
});
test("daily totals and tooltip pairs use corresponding dates, with missing days left null", () => {
  const data = buildOrderChart(
    "2026-10-14",
    "2026-10-15",
    "period",
    "Asia/Kolkata",
    [
      row("2026-10-14", 50),
      row("2026-10-15", 40),
      row("2026-10-12", 60),
      row("2026-10-13", 40),
    ],
    [],
    now,
  );
  assert.equal(data.total, 90);
  assert.equal(data.comparisonTotal, 100);
  assert.equal(data.percent, -10);
  assert.equal(data.points[1].comparisonDate, "2026-10-13");
  const missing = buildOrderChart(
    "2026-10-14",
    "2026-10-15",
    "period",
    "Asia/Kolkata",
    [row("2026-10-14", 0)],
    [],
    now,
  );
  assert.equal(missing.total, null);
  assert.equal(missing.points[0].current, 0);
  assert.equal(missing.points[1].current, null);
  assert.equal(missing.comparisonTotal, null);
});
test("intraday pairs actual update times within 15 minutes and excludes full-day backfills", () => {
  const data = buildOrderChart(
    "2026-10-16",
    "2026-10-16",
    "period",
    "Asia/Kolkata",
    [],
    [
      row("2026-10-16", 80),
      row("2026-10-15", 100, "2026-10-15T06:03:00Z"),
      row("2026-10-15", 900, "2026-10-16T06:00:00Z"),
    ],
    now,
  );
  assert.equal(data.mode, "intraday");
  assert.equal(data.total, 80);
  assert.equal(data.comparisonTotal, 100);
  assert.equal(data.percent, -20);
  assert.equal(data.points.length, 1);
  assert.equal(data.points[0].comparisonAt, "2026-10-15T06:03:00Z");
});
