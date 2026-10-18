import { test } from "node:test";
import assert from "node:assert/strict";
import {
  combineProductSnapshots,
  productDays,
  type ProductSnapshot,
} from "../lib/product-report-ranges";
import { reportDates } from "../lib/report-ranges";
import type { StoreProductsData } from "../lib/types";
const campaign = {
  id: "c",
  name: "Campaign",
  status: "PAUSED",
  channel: "SHOPPING",
  budgetId: "shared",
  budget: 100,
  budgetPeriod: "DAILY",
  sharedBudget: true,
  targetCpa: 2,
  biddingStrategy: "TARGET_CPA",
  spend: 999,
  clicks: 2,
  impressions: 20,
  conversions: 2,
  costPerConversion: 5,
};
const data: StoreProductsData = {
  syncComplete: true,
  products: [],
  campaigns: [campaign],
  links: [],
  performance: [],
  date: "2026-09-01 – 2026-09-30",
  currency: "USD",
  timezone: "America/New_York",
  fetchedAt: "2026-10-01T12:00:00Z",
  adsError: null,
  catalogError: null,
  campaignDaily: reportDates("2026-09-01", "2026-09-30").map((date, index) => ({
    campaignId: "c",
    date,
    spend: 999,
    clicks: 2,
    impressions: 20,
    conversions: index % 2 ? 3 : 1,
    costPerConversion: index % 2 ? 10 : 2,
  })),
  productDaily: reportDates("2026-09-01", "2026-09-30").map((date) => ({
    date,
    campaignId: "c",
    itemId: "sku",
    title: "Product",
    spend: 4,
    clicks: 1,
    impressions: 10,
    conversions: 0.5,
  })),
};
function snapshots(): ProductSnapshot[] {
  return productDays(data, "2026-09-01", "2026-09-30").map((payload) => ({
    from: payload.date,
    to: payload.date,
    payload,
    checkedAt: data.fetchedAt,
  }));
}
test("one 30-day sync supplies smaller campaign and product ranges without summing budgets or averaging CPA", () => {
  const result = combineProductSnapshots(
    snapshots(),
    "2026-09-01",
    "2026-09-07",
  )!;
  assert.equal(result.syncComplete, true);
  assert.equal(result.campaignDaily?.length, 7);
  assert.equal(result.campaigns[0].spend, 6993);
  assert.equal(result.campaigns[0].conversions, 13);
  assert.equal(result.campaigns[0].costPerConversion, 98 / 13);
  assert.equal(result.campaigns[0].budget, 100);
  assert.equal(result.campaigns[0].targetCpa, 2);
  assert.equal(result.campaigns[0].status, "PAUSED");
  assert.equal(result.performance.length, 1);
  assert.equal(result.performance[0].spend, 28);
  assert.equal(result.performance[0].conversions, 3.5);
});
test("missing dates and incompatible currencies never masquerade as a fully saved range", () => {
  assert.equal(
    combineProductSnapshots(snapshots().slice(1), "2026-09-01", "2026-09-07"),
    undefined,
  );
  const rows = snapshots();
  rows[0].payload.currency = "INR";
  assert.equal(
    combineProductSnapshots(rows, "2026-09-01", "2026-09-07"),
    undefined,
  );
});
test("new daily refreshes supersede older exact ranges; newer exact provider totals take precedence", () => {
  const rows = snapshots();
  const exact = {
    from: "2026-09-01",
    to: "2026-09-07",
    payload: { ...data, campaigns: [{ ...campaign, spend: 42 }] },
    checkedAt: "2026-09-30T00:00:00Z",
  };
  rows.push(exact);
  assert.equal(
    combineProductSnapshots(rows, exact.from, exact.to)?.campaigns[0].spend,
    6993,
  );
  exact.checkedAt = "2026-10-02T00:00:00Z";
  assert.equal(
    combineProductSnapshots(rows, exact.from, exact.to)?.campaigns[0].spend,
    42,
  );
});
test("a successful empty daily result means zero activity; missing conversion costs stay unavailable", () => {
  const [empty] = productDays(
    { ...data, campaignDaily: [], productDaily: [] },
    "2026-09-01",
    "2026-09-01",
  );
  assert.equal(empty.campaigns[0].spend, 0);
  assert.equal(empty.campaigns[0].costPerConversion, null);
  const rows = snapshots();
  rows[0].payload.campaigns[0].costPerConversion = null;
  assert.equal(
    combineProductSnapshots(rows, "2026-09-01", "2026-09-02")?.campaigns[0]
      .costPerConversion,
    null,
  );
});
