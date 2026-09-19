import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAds } from "../lib/server/google";
import { matchProduct, productRows } from "../lib/product-matching";
const auth = {
  accessToken: "test",
  config: { clientId: "test", clientSecret: "test" },
};
test("product feed items match only exact Shopify IDs or unique SKUs", () => {
  const products = [
    {
      id: "gid://shopify/Product/100",
      title: "Alpha",
      handle: "alpha",
      status: "ACTIVE",
      image: null,
      variants: [
        {
          id: "gid://shopify/ProductVariant/101",
          title: "Default",
          sku: "UNIQUE-SKU",
          price: "10.00",
        },
      ],
    },
    {
      id: "gid://shopify/Product/200",
      title: "Beta",
      handle: "beta",
      status: "ACTIVE",
      image: null,
      variants: [
        {
          id: "gid://shopify/ProductVariant/201",
          title: "Default",
          sku: "SHARED",
          price: "20.00",
        },
      ],
    },
    {
      id: "gid://shopify/Product/300",
      title: "Alpha",
      handle: "alpha-two",
      status: "ACTIVE",
      image: null,
      variants: [
        {
          id: "gid://shopify/ProductVariant/301",
          title: "Default",
          sku: "SHARED",
          price: "30.00",
        },
      ],
    },
  ];
  assert.equal(matchProduct("shopify_IN_100_101", products), products[0].id);
  assert.equal(matchProduct("UNIQUE-SKU", products), products[0].id);
  assert.equal(matchProduct("SHARED", products), null);
  assert.equal(matchProduct("Alpha", products), null);
  const rows = [
    {
      itemId: "shopify_IN_100_101",
      title: "Alpha",
      campaignId: "1",
      spend: 5,
      clicks: 2,
      impressions: 9,
      conversions: 1,
    },
  ];
  assert.deepEqual(productRows(products[0].id, products, rows), rows);
});
test("Google report keeps source values, deduplicates shared budgets, and refuses mixed-conversion CPA", async () => {
  const original = globalThis.fetch;
  let mixed = true;
  const dateFilters: string[] = [];
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).has("developer-token"), false);
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("segments.date")) dateFilters.push(query);
    let results: unknown[] = [];
    if (query.includes("customer.currency_code"))
      results = [
        { customer: { currencyCode: "INR", timeZone: "Asia/Kolkata" } },
      ];
    else if (query.includes("conversion_action_category"))
      results = [
        {
          segments: { conversionActionCategory: "PURCHASE" },
          metrics: { conversions: 10 },
        },
        ...(mixed
          ? [
              {
                segments: { conversionActionCategory: "SIGNUP" },
                metrics: { conversions: 5 },
              },
            ]
          : []),
      ];
    else if (query.includes("cost_per_conversion"))
      results = [
        {
          metrics: {
            costMicros: "1500000000",
            costPerConversion: "150000000",
            conversions: 10,
          },
        },
      ];
    else
      results = ["One", "Two"].map((name, i) => ({
        campaign: { id: String(i), name, status: "ENABLED" },
        campaignBudget: {
          id: "shared-1",
          name: "Shared daily",
          amountMicros: "5000000000",
          period: "DAILY",
          explicitlyShared: true,
        },
        metrics: { costMicros: "700000000" },
      }));
    return Response.json({ results });
  };
  try {
    const report = await fetchAds(
      { cid: "1234567890", manager_cid: "" },
      auth,
      0,
      "2026-09-17",
    );
    assert.equal(report.spend, 1500);
    assert.equal(report.purchases, 10);
    assert.equal(report.costPerPurchase, null);
    assert.equal(report.budgets.length, 1);
    assert.deepEqual(report.budgets[0].campaigns, ["One", "Two"]);
    assert.equal(report.budgets[0].amount, 5000);
    mixed = false;
    const purchaseOnly = await fetchAds(
      { cid: "1234567890", manager_cid: "" },
      auth,
      0,
      "2026-09-17",
    );
    assert.equal(purchaseOnly.costPerPurchase, 150);
    await fetchAds(
      { cid: "1234567890", manager_cid: "" },
      auth,
      0,
      "2026-09-10",
      "2026-09-17",
    );
    assert.ok(
      dateFilters.some((query) =>
        query.includes("segments.date BETWEEN '2026-09-10' AND '2026-09-17'"),
      ),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("Google pagination is exhausted before rendering a report", async () => {
  const original = globalThis.fetch;
  const { adsQuery } = await import("../lib/server/google");
  let pages = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    pages++;
    return Response.json(
      body.pageToken
        ? { results: [{ id: 2 }] }
        : { results: [{ id: 1 }], nextPageToken: "next" },
    );
  };
  try {
    assert.deepEqual(
      await adsQuery(
        "1234567890",
        "",
        auth,
        "SELECT campaign.id FROM campaign",
      ),
      [{ id: 1 }, { id: 2 }],
    );
    assert.equal(pages, 2);
  } finally {
    globalThis.fetch = original;
  }
});
