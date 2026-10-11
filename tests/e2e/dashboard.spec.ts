import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { encrypt } from "../../lib/server/crypto";
import { dateInZone } from "../../lib/reporting";
const local = JSON.parse(readFileSync(".local/config.json", "utf8"));
if (!process.env.TEST_DATABASE_URL?.endsWith("/storedesk_browser_test"))
  throw new Error("Browser tests require their isolated database.");
const sql = postgres(process.env.TEST_DATABASE_URL);
const password = "local-browser-check-passphrase";
test("local owner setup, persisted mapping, source reports, examples, and mobile navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/setup#" + local.SETUP_TOKEN);
  await page.getByLabel("Dashboard password").fill(password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Store overview" }),
  ).toBeVisible();
  // Multiple existing identities, including a third account, drive every account picker.
  for (const group of [1, 2, 3])
    await sql`INSERT INTO google_connections(group_id,email,token_cipher) VALUES(${group},${`account${group}@example.test`},${encrypt({ refreshToken: "browser-fixture" })})`;
  await page.reload();
  await page
    .getByRole("button", { name: "Connections", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "Add store", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Store name").fill("Local QA Store");
  await dialog.getByLabel("Google Ads CID").fill("123-456-7890");
  await dialog.getByLabel("Shopify domain").fill("local-qa.myshopify.com");
  await dialog.getByLabel("Assign Google account").click();
  await page.getByRole("option", { name: "account3@example.test" }).click();
  await dialog.getByRole("button", { name: "Save store" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Local QA Store", { exact: true })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Connections", exact: false })
    .first()
    .click();
  await expect(page.getByText("Local QA Store", { exact: true })).toBeVisible();
  const [store] =
    await sql`SELECT id,group_id FROM stores WHERE domain='local-qa.myshopify.com'`;
  expect(store.group_id).toBe(3);
  for (const offset of [-1, 0]) {
    const date = dateInZone("Asia/Kolkata", offset);
    const ads = {
      spend: offset === 0 ? 200 : 500,
      purchases: 2,
      costPerPurchase: 250,
      costNote: "Test fixture only",
      currency: "INR",
      timezone: "Asia/Kolkata",
      date,
      fetchedAt: new Date().toISOString(),
      budgets: [
        {
          id: "shared",
          name: "QA Shared",
          amount: 1000,
          shared: true,
          period: "DAILY",
          campaigns: ["QA Shopping", "QA Brand"],
        },
        {
          id: "second",
          name: "QA Search",
          amount: 500,
          shared: false,
          period: "DAILY",
          campaigns: ["QA Search"],
        },
      ],
      campaigns: [
        {
          id: "1",
          name: "QA Shopping",
          status: "ENABLED",
          spend: 500,
          targetCpa: null,
          budgetId: "shared",
        },
      ],
      raw: { test: true },
    };
    const shop = {
      sales: offset === 0 ? 800 : 2000,
      orders: 4,
      currency: "INR",
      timezone: "Asia/Kolkata",
      date,
      fetchedAt: new Date().toISOString(),
      raw: { test: true },
    };
    for (const [source, payload] of [
      ["ads", ads],
      ["shop", shop],
    ] as const)
      await sql`INSERT INTO reports(store_id,source,report_date,payload) VALUES(${store.id},${source},${date},${sql.json(payload)}) ON CONFLICT(store_id,source,report_date) DO UPDATE SET payload=EXCLUDED.payload,error=NULL`;
  }
  const yesterday = dateInZone("Asia/Kolkata", -1);
  const productId = "gid://shopify/Product/9001";
  await sql`INSERT INTO store_product_snapshots(store_id,start_date,end_date,payload) VALUES(${store.id},${yesterday},${yesterday},${sql.json(
    {
      products: [
        {
          id: productId,
          title: "QA Product",
          handle: "qa-product",
          status: "ACTIVE",
          image: null,
          variants: [
            {
              id: "gid://shopify/ProductVariant/9002",
              title: "Default Title",
              sku: "QA-SKU",
              price: "499.00",
            },
          ],
        },
      ],
      campaigns: [
        {
          id: "1",
          name: "QA Shopping",
          status: "ENABLED",
          channel: "SHOPPING",
          targetCpa: null,
          budgetId: "shared",
          budget: 1000,
          budgetPeriod: "DAILY",
          sharedBudget: true,
          spend: 500,
          clicks: 12,
          impressions: 300,
          conversions: 2,
        },
      ],
      campaignDaily: [],
      performance: [
        {
          itemId: "shopify_IN_9001_9002",
          title: "QA Product",
          campaignId: "1",
          spend: 500,
          clicks: 12,
          impressions: 300,
          conversions: 2,
        },
      ],
      links: [],
      date: yesterday,
      currency: "INR",
      timezone: "Asia/Kolkata",
      catalogError: null,
      adsError: null,
      fetchedAt: new Date().toISOString(),
    },
  )}) ON CONFLICT(store_id,start_date,end_date) DO UPDATE SET payload=EXCLUDED.payload,checked_at=now()`;
  await sql`INSERT INTO product_campaign_links(store_id,product_id,campaign_id) VALUES(${store.id},${productId},'1') ON CONFLICT DO NOTHING`;
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.reload();
  await page.getByLabel("Filter by Google login").click();
  await page.getByRole("option", { name: "account1@example.test" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching stores" }),
  ).toBeVisible();
  await page.getByLabel("Filter by Google login").click();
  await page.getByRole("option", { name: "account3@example.test" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching stores" }),
  ).not.toBeVisible();
  await page.getByLabel("Filter by Google login").click();
  await page.getByRole("option", { name: "All Google accounts" }).click();
  await expect(page.getByText("₹500.00", { exact: true })).toBeVisible();
  let rangeSyncs = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/sync")) rangeSyncs++;
  });
  await page.getByRole("button", { name: "Choose report date range" }).click();
  await expect(page.locator(".date-preset-list")).toBeVisible();
  await expect(page.locator(".rdp-month")).toHaveCount(2);
  await page.screenshot({
    path: "outputs/date-range-filter.png",
    fullPage: true,
  });
  await page
    .locator(".date-preset-list")
    .getByRole("button", { name: "Today", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText("₹200.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose report date range" }).click();
  await page
    .locator(".date-preset-list")
    .getByRole("button", { name: "Yesterday", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  expect(rangeSyncs).toBe(0);
  const exported = await page.request.get(
    `/api/export?from=${yesterday}&to=${yesterday}`,
  );
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("text/csv");
  const exportedText = await exported.text();
  for (const value of [
    "Google account",
    "Store summary",
    "Budget",
    "Campaign",
    "Shopify product",
    "Product ad activity",
    "Manual product campaign link",
    "QA-SKU",
    yesterday,
  ])
    expect(exportedText).toContain(value);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export report" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export report" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByLabel("How many days?").fill("1");
  await exportDialog.getByLabel("End date").fill(yesterday);
  await exportDialog.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    `spenddesk-${yesterday}-${yesterday}.csv`,
  );
  // A new range triggers preparation and downloads without changing the overview.
  const exportStart = dateInZone("Asia/Kolkata", -7);
  let exportRequests = 0;
  await page.route(
    `**/api/export?from=${exportStart}&to=${yesterday}`,
    (route) => {
      exportRequests++;
      return exportRequests === 1
        ? route.fulfill({ status: 409, json: { error: "Not ready" } })
        : route.fulfill({ contentType: "text/csv", body: exportedText });
    },
  );
  await page.route("**/api/sync", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      from: exportStart,
      to: yesterday,
      missingOnly: true,
    });
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.getByRole("button", { name: "Export report" }).click();
  await exportDialog.getByLabel("How many days?").fill("7");
  const rangeDownloadPromise = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Download CSV" }).click();
  await expect(
    exportDialog.getByRole("button", { name: "Preparing…" }),
  ).toBeDisabled();
  expect((await rangeDownloadPromise).suggestedFilename()).toBe(
    `spenddesk-${exportStart}-${yesterday}.csv`,
  );
  expect(exportRequests).toBe(2);
  await page.unroute("**/api/sync");
  await page
    .getByRole("button", { name: "Edit Local QA Store", exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("QA Shared", { exact: true })).toHaveCount(1);
  await expect(sheet.getByText("Shared · shown once")).toBeVisible();
  await expect(sheet.getByText("INR · Asia/Kolkata").first()).toBeVisible();
  await sheet.locator("summary").filter({ hasText: "QA Product" }).click();
  await expect(sheet.getByLabel("Assign campaign to QA Product")).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Remove QA Shopping from QA Product" }),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  const performanceFixture = await (
    await page.request.get(
      `/api/store-products?id=${store.id}&from=${yesterday}&to=${yesterday}`,
    )
  ).json();
  const sevenStart = dateInZone("Asia/Kolkata", -6);
  const sevenEnd = dateInZone("Asia/Kolkata");
  await page.route(
    `**/api/store-products?id=${store.id}&from=${sevenStart}&to=${sevenEnd}`,
    (route) =>
      route.fulfill({
        json: {
          ...performanceFixture,
          date: `${sevenStart} – ${sevenEnd}`,
          campaignDaily: [
            {
              campaignId: "1",
              date: sevenEnd,
              spend: 123,
              clicks: 9,
              impressions: 80,
              conversions: 2,
            },
          ],
        },
      }),
  );
  const overviewUrl = page.url();
  await page
    .getByRole("button", { name: /Local QA Store/ })
    .first()
    .click();
  const inline = page.getByRole("region", {
    name: "Local QA Store campaign performance",
  });
  await expect(inline).toBeVisible();
  await expect(page).toHaveURL(overviewUrl);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(inline.getByText("Last 7 days", { exact: true })).toBeVisible();
  await expect(
    inline.getByRole("tab", { name: /All campaigns/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(inline.getByText("QA Shopping", { exact: true })).toBeVisible();
  await expect(
    inline.getByText("Campaign spend", { exact: false }),
  ).toBeVisible();
  await inline
    .getByRole("button", { name: "QA Shopping", exact: true })
    .click();
  const daily = inline.getByRole("region", {
    name: "QA Shopping daily performance",
  });
  await expect(daily).toBeVisible();
  await expect(daily.getByText("Last 7 days", { exact: true })).toBeVisible();
  await expect(daily.locator("tbody tr")).toHaveCount(7);
  await expect(daily.locator("tbody tr").first()).toContainText("123");
  await expect(daily.locator("tbody tr").nth(1)).toContainText("—");
  await daily.getByLabel("Choose report date range").click();
  await page.getByRole("button", { name: "Yesterday", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(daily.locator("tbody tr")).toHaveCount(1);
  await expect(
    inline
      .locator(":scope > .products-heading")
      .getByText("Last 7 days", { exact: true }),
  ).toBeVisible();
  await inline
    .getByRole("button", { name: "QA Shopping", exact: true })
    .click();
  await expect(daily).toHaveCount(0);
  await inline.getByLabel("Choose report date range").click();
  await page.getByRole("button", { name: "Yesterday", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    inline
      .getByLabel("Choose report date range")
      .getByText("Yesterday", { exact: true }),
  ).toBeVisible();
  await inline.getByRole("tab", { name: /Products/ }).click();
  await inline.locator("summary").filter({ hasText: "QA Product" }).click();
  await expect(inline.getByLabel("Assign campaign to QA Product")).toHaveCount(
    0,
  );
  await expect(
    inline.getByRole("button", { name: "Remove QA Shopping from QA Product" }),
  ).toHaveCount(0);
  await expect(
    inline.getByText("Reported product link", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Local QA Store/ })
    .first()
    .click();
  await expect(inline).toHaveCount(0);
  await page.getByLabel("Search stores or CIDs").fill("missing-store");
  await expect(
    page.getByRole("heading", { name: "No matching stores" }),
  ).toBeVisible();
  await page.getByLabel("Clear search").click();
  await page.screenshot({ path: "outputs/local-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "Connections", exact: false })
    .first()
    .click();
  await page.getByText("Local QA Store", { exact: true }).click();
  await dialog.getByLabel("Store name").fill("Local QA Renamed");
  await dialog.getByRole("button", { name: "Save store" }).click();
  await expect(
    page.getByText("Local QA Renamed", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Connections", exact: false })
    .first()
    .click();
  await expect(
    page.getByText("Local QA Renamed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Set up Google API" }).click();
  await dialog
    .getByLabel("OAuth client ID")
    .fill("qa-client.apps.googleusercontent.com");
  await dialog
    .getByLabel("OAuth client secret")
    .fill("qa-client-secret-for-local-test");
  await dialog.getByRole("button", { name: "Save API settings" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "Connect Google", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Reconnect", exact: true }),
  ).toHaveCount(3);
  const startNew = await page.request.get("/api/google/start", {
    maxRedirects: 0,
  });
  expect(startNew.status()).toBe(307);
  const redirect = new URL(startNew.headers()["location"]);
  expect(redirect.hostname).toBe("accounts.google.com");
  const [state] =
    await sql`SELECT group_id FROM oauth_states WHERE state=${redirect.searchParams.get("state")!}`;
  expect(state.group_id).toBeNull();
  const reconnect = await page.request.get("/api/google/start?group=3", {
    maxRedirects: 0,
  });
  expect(reconnect.status()).toBe(307);
  expect(
    (
      await page.request.get("/api/google/start?group=999999", {
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(404);
  const [savedConfig] =
    await sql`SELECT value FROM settings WHERE key='google_config'`;
  expect(savedConfig.value).not.toContain("qa-client-secret");
  const publicData = await (await page.request.get("/api/dashboard")).json();
  expect(JSON.stringify(publicData)).not.toContain(
    "qa-client-secret-for-local-test",
  );
  await sql`DELETE FROM settings WHERE key='google_config'`;
  // Unauthorized and malformed input remain rejected; checks never use live provider credentials.
  const denied = await page.request.post("/api/stores", {
    headers: { Origin: "https://wrong-origin.example" },
    data: {},
  });
  expect(denied.status()).toBe(403);
  const duplicate = await page.request.post("/api/stores", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {
      name: "Duplicate",
      domain: "local-qa.myshopify.com",
      cid: "1234567890",
      group: 3,
    },
  });
  expect(duplicate.status()).toBe(409);
  const unconnected = await page.request.post("/api/stores", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {
      name: "Unknown account",
      domain: "unknown.myshopify.com",
      cid: "9999999999",
      group: 999,
    },
  });
  expect(unconnected.status()).toBe(400);
  const invalid = await page.request.get("/api/dashboard?date=2026-02-30");
  expect(invalid.status()).toBe(400);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "outputs/local-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("button", { name: "Setup guide", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Let’s connect your stores" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Dashboard password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Store overview" }),
  ).toBeVisible();
  // Clean local QA fixture so the user's workspace starts empty.
  await sql`DELETE FROM stores WHERE domain='local-qa.myshopify.com'`;
  await page.reload();
  await page.getByRole("button", { name: "Preview with example data" }).click();
  await expect(page.getByText("You’re viewing example data")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit Crafted Goods" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit Crafted Goods" }).click();
  const exampleSheet = page.getByRole("dialog");
  await expect(
    exampleSheet.getByRole("heading", { name: "Products & campaigns" }),
  ).toBeVisible();
  await expect(exampleSheet.getByText("Everyday essentials")).toBeVisible();
  await exampleSheet
    .locator("summary")
    .filter({ hasText: "Everyday essentials" })
    .click();
  await expect(
    exampleSheet.getByText("Reported product link").first(),
  ).toBeVisible();
  await page.screenshot({
    path: "outputs/product-workspace.png",
    fullPage: true,
  });
  await exampleSheet
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByLabel("Search stores or CIDs").fill("Oak");
  await expect(
    page.getByRole("button", { name: "Edit Oak & Linen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit Crafted Goods" }),
  ).toHaveCount(0);
  await page.getByLabel("Clear search").click();
  await page.getByRole("button", { name: "Back to live data" }).click();
  await expect(
    page.getByRole("heading", { name: "Your stores belong here" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test.afterAll(async () => {
  await sql`DELETE FROM stores WHERE domain='local-qa.myshopify.com'`;
  await sql`DELETE FROM settings WHERE key='owner_password'`;
  await sql`DELETE FROM settings WHERE key='google_config'`;
  await sql`DELETE FROM auth_attempts`;
  await sql.end();
});
