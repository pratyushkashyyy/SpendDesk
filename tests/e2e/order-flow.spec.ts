import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { encrypt, hashPassword } from "../../lib/server/crypto";
import { dateInZone } from "../../lib/reporting";

test("store rows show today below yesterday, previous-hour values below today, and same-time order flow", async ({
  page,
  request,
}) => {
  if (!process.env.TEST_DATABASE_URL?.endsWith("/storedesk_browser_test"))
    throw new Error("Isolated database required.");
  const sql = postgres(process.env.TEST_DATABASE_URL);
  const password = "order-flow-browser-passphrase";
  const ids: string[] = [];
  const now = new Date();
  const today = dateInZone("Asia/Kolkata", 0, now),
    yesterday = dateInZone("Asia/Kolkata", -1, now);
  const hourAgo = new Date(now.getTime() - 3600000).toISOString();
  let dashboardReads = 0;
  const reportRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (req.url().includes("/api/dashboard?")) {
      dashboardReads++;
      reportRequests.push(req.url());
    }
  });
  try {
    await sql`INSERT INTO settings(key,value) VALUES('owner_password',${hashPassword(password)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    await sql`INSERT INTO settings(key,value) VALUES('google_config',${encrypt({ clientId: "order-flow-fixture", clientSecret: "fixture" })}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    await sql`INSERT INTO google_connections(group_id,email,token_cipher) VALUES(30,'flow@example.test',${encrypt({ refreshToken: "fixture" })}) ON CONFLICT(group_id) DO NOTHING`;
    for (const [i, name, orders, baseline, full] of [
      [0, "SimplyHouse Store", 280, 250, 1022],
      [1, "PestShieldX", 90, 150, 550],
      [2, "CasaRinse", 130, 100, 441],
    ] as const) {
      const id = randomUUID();
      ids.push(id);
      await sql`INSERT INTO stores(id,name,domain,cid,group_id,shop_cipher) VALUES(${id},${name},${`flow-${i}.myshopify.com`},${`900000000${i}`},30,${encrypt({ accessToken: "fixture" })})`;
      const ads = {
        date: today,
        timezone: "Asia/Kolkata",
        currency: "USD",
        fetchedAt: now.toISOString(),
        spend: 210.73 + i,
        purchases: 200.24 + i,
        costPerPurchase: 1.05,
        costNote: "Fixture only",
        budgets: [
          {
            id: "b",
            name: "Daily",
            amount: 1010,
            period: "DAILY",
            campaigns: ["Shopping"],
            shared: false,
          },
        ],
        campaigns: [],
        alerts: [],
        raw: { hidden: true },
      };
      const shop = {
        date: today,
        timezone: "Asia/Kolkata",
        currency: "USD",
        fetchedAt: now.toISOString(),
        sales: 9999,
        orders,
        raw: { hidden: true },
      };
      for (const [source, payload] of [
        ["ads", ads],
        ["shop", shop],
      ] as const) {
        await sql`INSERT INTO reports(store_id,source,report_date,payload) VALUES(${id},${source},${today},${sql.json(payload)})`;
        const old = {
          ...payload,
          date: yesterday,
          ...(source === "shop" ? { orders: full } : { spend: 690.93 + i }),
        };
        await sql`INSERT INTO reports(store_id,source,report_date,payload) VALUES(${id},${source},${yesterday},${sql.json(old)})`;
        const previous = {
          ...payload,
          fetchedAt: hourAgo,
          ...(source === "shop"
            ? { orders: orders - 20 }
            : { spend: 185.1 + i, purchases: 180.24 + i }),
        };
        if (dateInZone("Asia/Kolkata", 0, new Date(hourAgo)) === today)
          await sql`INSERT INTO report_observations(store_id,source,report_date,observed_at,timezone,payload) VALUES(${id},${source},${today},${hourAgo},'Asia/Kolkata',${sql.json(previous)})`;
      }
      const baselineAt = new Date(now.getTime() - 86400000).toISOString();
      await sql`INSERT INTO report_observations(store_id,source,report_date,observed_at,timezone,payload) VALUES(${id},'shop',${yesterday},${baselineAt},'Asia/Kolkata',${sql.json({ ...shop, date: yesterday, fetchedAt: baselineAt, orders: baseline })})`;
    }
    await page.setViewportSize({ width: 1920, height: 1100 });
    await page.goto("/login");
    await page.getByLabel("Dashboard password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3100/");
    const row = page
      .locator(".store-navigation-row")
      .filter({ hasText: "SimplyHouse Store" });
    await expect(row.locator('[aria-label="Today orders: 280"]')).toBeVisible();
    await expect(row.getByText("1,022", { exact: true })).toBeVisible();
    await expect(
      row.getByLabel("Order flow for SimplyHouse Store: On pace"),
    ).toBeVisible();
    await expect(
      page.getByLabel("Order flow for PestShieldX: Slower"),
    ).toBeVisible();
    await expect(
      page.getByLabel("Order flow for CasaRinse: Ahead"),
    ).toBeVisible();
    const response = await page.request.get(
      `/api/dashboard?from=${yesterday}&to=${yesterday}`,
    );
    const body = await response.json();
    const live = body.stores.find((store: any) => store.id === ids[0]).live;
    expect(live.orderFlow.yesterdayOrders).toBe(250);
    expect(live.today.ads.raw).toBeUndefined();
    expect(live.today.shop.raw).toBeUndefined();
    expect(live.orderHistory.some((point: any) => point.orders === 250)).toBe(
      true,
    );
    expect(live.orderHistory.some((point: any) => point.orders === 1022)).toBe(
      false,
    );
    const arrow = row.getByRole("button", {
      name: "Order flow for SimplyHouse Store: On pace",
    });
    await expect(arrow).toHaveText("");
    await expect(arrow).toHaveClass(/flow-arrow-up/);
    await expect(
      page.getByRole("button", { name: "Order flow for PestShieldX: Slower" }),
    ).toHaveClass(/flow-arrow-down/);
    await arrow.click();
    const chart = page.getByRole("dialog");
    await expect(
      chart.getByText("SimplyHouse Store · Order flow", { exact: true }),
    ).toBeVisible();
    await expect(
      chart.getByRole("img", {
        name: "Today and comparison cumulative orders by local time",
      }),
    ).toBeVisible();
    await expect(chart.getByText("+12%", { exact: true })).toBeVisible();
    await chart.getByText("View saved data", { exact: true }).click();
    await expect(chart.locator("tbody")).toContainText("250");
    await expect(chart.locator(".recharts-line-dot").first()).toBeVisible();
    await chart.locator(".recharts-line-dot").first().hover();
    await expect(chart.locator(".flow-chart-tooltip")).toBeVisible();
    await chart.getByText("Orders over time", { exact: true }).hover();
    await chart.screenshot({ path: "outputs/order-flow-chart-yesterday.png" });
    await expect(
      page.getByRole("region", {
        name: "SimplyHouse Store campaign performance",
      }),
    ).toHaveCount(0);
    await chart.getByRole("button", { name: "Close", exact: true }).click();
    await expect(chart).toHaveCount(0);
    await expect(arrow).toBeFocused();
    await page
      .locator(".report-panel")
      .screenshot({ path: "outputs/order-flow-yesterday.png" });
    await page
      .getByRole("button", { name: "Choose report date range" })
      .click();
    await page
      .locator(".date-preset-list")
      .getByRole("button", { name: "Today", exact: true })
      .click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    if (dateInZone("Asia/Kolkata", 0, new Date(hourAgo)) === today) {
      await expect(
        row.locator('[aria-label="~1h ago orders: 260"]'),
      ).toBeVisible();
      await row
        .getByRole("button", {
          name: "Order flow for SimplyHouse Store: Orders coming in",
        })
        .click();
      const chart = page.getByRole("dialog");
      await expect(
        chart.getByText("+20 orders in 60 min", { exact: true }),
      ).toBeVisible();
      await expect(
        chart.getByRole("img", {
          name: "Today and comparison cumulative orders by local time",
        }),
      ).toBeVisible();
      await chart.screenshot({ path: "outputs/order-flow-chart-today.png" });
      await page.keyboard.press("Escape");
      await expect(chart).toHaveCount(0);
    }
    await expect(row.getByText("280", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Order flow", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByLabel("Saved report times for SimplyHouse Store"),
    ).toHaveCount(0);
    // Removing yesterday history must not hide a valid hourly comparison.
    await sql`DELETE FROM report_observations WHERE store_id=${ids[0]} AND report_date=${yesterday}`;
    await sql`DELETE FROM report_observations WHERE store_id=${ids[1]} AND observed_at=${hourAgo}`;
    reportRequests.length = 0;
    await page.reload();
    await expect(
      page
        .getByLabel("Choose report date range")
        .getByText("Today", { exact: true }),
    ).toBeVisible();
    await expect(row.getByText("280", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("period")).toBe("today");
    expect(new URL(reportRequests[0]).searchParams.get("from")).toBe(today);
    expect(new URL(reportRequests[0]).searchParams.get("to")).toBe(today);
    // Yesterday's missing baseline remains explicit when selected deliberately.
    await page.getByLabel("Choose report date range").click();
    await page
      .locator(".date-preset-list")
      .getByRole("button", { name: "Yesterday", exact: true })
      .click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(
      row.getByLabel(
        "Order flow for SimplyHouse Store: Yesterday snapshot missing",
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Choose report date range" })
      .click();
    await page
      .locator(".date-preset-list")
      .getByRole("button", { name: "Today", exact: true })
      .click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    if (dateInZone("Asia/Kolkata", 0, new Date(hourAgo)) === today) {
      await expect(
        row.getByLabel("Order flow for SimplyHouse Store: Orders coming in"),
      ).toBeVisible();
      const missing = page
        .locator(".store-navigation-row")
        .filter({ hasText: "PestShieldX" });
      await expect(
        missing.getByText("No snapshot", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        missing.getByLabel("Order flow for PestShieldX: Previous hour missing"),
      ).toBeVisible();
    }
    await page
      .locator(".report-panel")
      .screenshot({ path: "outputs/order-flow-today.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
    // The pop-up fits a narrow phone screen and opens from a neutral arrow too.
    const missingArrow = page.getByRole("button", {
      name: "Order flow for PestShieldX: Previous hour missing",
    });
    if (dateInZone("Asia/Kolkata", 0, new Date(hourAgo)) === today) {
      await missingArrow.scrollIntoViewIfNeeded();
      await missingArrow.click();
      const chart = page.getByRole("dialog");
      await expect(chart).toBeVisible();
      await expect(chart.getByText(/No snapshot 45–75 minutes/)).toBeVisible();
      const bounds = await chart.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.width).toBeLessThanOrEqual(390);
      await expect(chart.locator(".recharts-line-dot").first()).toBeVisible();
      await chart.screenshot({ path: "outputs/order-flow-chart-mobile.png" });
      await chart.getByRole("button", { name: "Close", exact: true }).click();
    }
    await page.screenshot({
      path: "outputs/order-flow-mobile.png",
      fullPage: true,
    });
    // Exact custom dates also survive reload and drive the very first data read.
    await page.setViewportSize({ width: 1920, height: 1100 });
    await page.getByLabel("Choose report date range").click();
    await page.getByLabel("Start date", { exact: true }).fill(yesterday);
    await page.getByLabel("End date", { exact: true }).fill(today);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(row.getByText("1,302", { exact: true })).toBeVisible();
    reportRequests.length = 0;
    await page.reload();
    await expect(
      page
        .getByLabel("Choose report date range")
        .getByText("Custom range", { exact: true }),
    ).toBeVisible();
    await expect(row.getByText("1,302", { exact: true })).toBeVisible();
    expect(new URL(reportRequests[0]).searchParams.get("from")).toBe(yesterday);
    expect(new URL(reportRequests[0]).searchParams.get("to")).toBe(today);
    expect(dashboardReads).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids) await sql`DELETE FROM stores WHERE id=${id}`;
    await sql`DELETE FROM google_connections WHERE group_id=30`;
    await sql`DELETE FROM settings WHERE key IN ('owner_password','google_config')`;
    await sql.end();
  }
});
