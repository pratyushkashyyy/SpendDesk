import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineDailyReports,
  reportDates,
  type SavedReport,
} from "../lib/report-ranges";

const row = (date: string, spend: number | null = 10): SavedReport => ({
  store_id: "store",
  source: "ads",
  report_date: date,
  error: null,
  checked_at: `${date}T12:00:00Z`,
  payload: {
    date,
    spend,
    purchases: 0.5,
    currency: "USD",
    timezone: "America/Los_Angeles",
    fetchedAt: `${date}T12:00:00Z`,
    budgets: [{ id: "budget", amount: 100 }],
    alerts: [],
    campaigns: [{ id: "campaign", spend }],
    costPerPurchase: 20,
  },
});

test("inclusive daily coverage reuses only selected days and never sums budgets or CPA", () => {
  const rows = reportDates("2026-09-01", "2026-09-30").map((date) => row(date));
  const result = combineDailyReports(rows, "2026-09-24", "2026-09-30")!;
  assert.equal(result.payload.spend, 70);
  assert.equal(result.payload.purchases, 3.5);
  assert.equal(result.payload.campaigns[0].spend, 70);
  assert.equal(result.payload.budgets[0].amount, 100);
  assert.equal(result.payload.costPerPurchase, null);
  assert.equal(result.payload.fetchedAt, "2026-09-24T12:00:00Z");
});

test("missing days, missing payloads and incompatible source metadata never count as coverage", () => {
  const rows = [row("2026-09-01"), row("2026-09-02")];
  assert.equal(
    combineDailyReports(rows, "2026-09-01", "2026-09-03"),
    undefined,
  );
  assert.equal(
    combineDailyReports(
      [{ ...rows[0], payload: null }, rows[1]],
      "2026-09-01",
      "2026-09-02",
    ),
    undefined,
  );
  for (const field of ["currency", "timezone"]) {
    assert.equal(
      combineDailyReports(
        [
          rows[0],
          { ...rows[1], payload: { ...rows[1].payload, [field]: "different" } },
        ],
        "2026-09-01",
        "2026-09-02",
      ),
      undefined,
    );
  }
});

test("unavailable metrics remain unavailable and failed refresh errors remain visible", () => {
  const rows = [
    row("2026-09-01", null),
    { ...row("2026-09-02"), error: "Refresh failed" },
  ];
  const result = combineDailyReports(rows, "2026-09-01", "2026-09-02")!;
  assert.equal(result.payload.spend, null);
  assert.equal(result.payload.campaigns[0].spend, null);
  assert.equal(result.error, "Refresh failed");
});

test("Shopify sales and orders retain their daily source dates", () => {
  const rows = reportDates("2026-09-01", "2026-09-07").map((date) => ({
    ...row(date),
    source: "shop",
    payload: {
      date,
      sales: 100,
      orders: 2,
      currency: "INR",
      timezone: "Asia/Kolkata",
      fetchedAt: "2026-09-08T00:00:00Z",
    },
  }));
  const result = combineDailyReports(rows, "2026-09-01", "2026-09-07")!;
  assert.equal(result.payload.sales, 700);
  assert.equal(result.payload.orders, 14);
});
