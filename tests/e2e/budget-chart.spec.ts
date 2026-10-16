import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { encrypt, hashPassword } from "../../lib/server/crypto";
import { dateInZone } from "../../lib/reporting";
import { reportDates } from "../../lib/report-ranges";
import { comparisonRange } from "../../lib/order-chart";
import { campaignActivity } from "../../lib/campaign-activity";
test("budget history retains previous amounts and edit times; Shopify-style chart compares selected days with prior month", async ({
  page,
}) => {
  if (!process.env.TEST_DATABASE_URL?.endsWith("/storedesk_browser_test"))
    throw Error("Isolated database required");
  const sql = postgres(process.env.TEST_DATABASE_URL, { onnotice: () => {} }),
    id = randomUUID(),
    password = "budget-chart-local-passphrase";
  const now = new Date(),
    today = dateInZone("Asia/Kolkata"),
    yesterday = dateInZone("Asia/Kolkata", -1),
    from = `${today.slice(0, 8)}01`;
  const previous = comparisonRange(from, today, "month");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await sql`INSERT INTO settings(key,value)VALUES('owner_password',${hashPassword(password)}) ON CONFLICT(key)DO UPDATE SET value=EXCLUDED.value`;
    await sql`INSERT INTO stores(id,name,domain,cid,group_id,shop_cipher)VALUES(${id},'Analytics Store','analytics-fixture.myshopify.com','9990000011',77,${encrypt({ accessToken: "fixture" })})`;
    for (const [i, date] of [
      ...new Set([
        ...reportDates(from, today),
        ...reportDates(previous.from, previous.to),
        yesterday,
      ]),
    ].entries()) {
      const isCurrent = date >= from;
      const orders =
        date === today
          ? 34
          : Math.max(
              20,
              Math.round((isCurrent ? 44 : 50) + Math.sin(i * 0.8) * 21),
            );
      await sql`INSERT INTO reports(store_id,source,report_date,payload)VALUES(${id},'shop',${date},${sql.json({ date, orders, timezone: "Asia/Kolkata", currency: "USD", fetchedAt: now.toISOString() })})`;
    }
    const budget = (amount: number) => [
      {
        id: "1",
        name: "Main campaign",
        amount,
        period: "DAILY",
        shared: true,
        campaigns: ["A", "B"],
      },
      {
        id: "2",
        name: "Second campaign",
        amount: 50,
        period: "DAILY",
        shared: false,
        campaigns: ["C"],
      },
    ];
    const ads = (amount: number, at: string) => ({
      date: today,
      timezone: "America/New_York",
      currency: "USD",
      fetchedAt: at,
      budgets: budget(amount),
      campaigns: [],
      alerts: [],
      spend: 90,
      purchases: 30,
      costPerPurchase: 3,
      costNote: "Fixture",
    });
    await sql`INSERT INTO reports(store_id,source,report_date,payload)VALUES(${id},'ads',${today},${sql.json(ads(100, new Date(now.getTime() - 7200000).toISOString()))})`;
    await sql`UPDATE reports SET payload=${sql.json(ads(200, now.toISOString()))} WHERE store_id=${id} AND source='ads'`;
    await sql`INSERT INTO reports(store_id,source,report_date,payload)VALUES(${id},'ads',${yesterday},${sql.json({ ...ads(100, new Date(now.getTime() - 7200000).toISOString()), date: yesterday })})`;
    const changedAt = new Date(now.getTime() - 3600000).toISOString();
    await sql`INSERT INTO google_budget_events(store_id,event_id,budget_id,previous_amount,amount,changed_at,currency,timezone)VALUES(${id},'fixture-change','1',100,200,${changedAt},'USD','America/New_York')`;
    await sql`UPDATE budget_states SET history_checked_at=now(),history_next_at=now()+INTERVAL '1 day' WHERE store_id=${id}`;
    const activity = campaignActivity(
      [
        {
          campaign: { id: "1", name: "A", status: "ENABLED" },
          campaignBudget: {
            id: "1",
            name: "Main campaign",
            period: "DAILY",
            amountMicros: "200000000",
            explicitlyShared: true,
          },
        },
        {
          campaign: { id: "2", name: "C", status: "PAUSED" },
          campaignBudget: {
            id: "2",
            name: "Second campaign",
            period: "DAILY",
            amountMicros: "50000000",
          },
        },
      ],
      [],
      "America/New_York",
      now.toISOString(),
    );
    await sql`UPDATE budget_states SET campaign_activity=${sql.json(activity)} WHERE store_id=${id}`;
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto("/login");
    await page.getByLabel("Dashboard password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page
        .locator(".store-navigation-row")
        .filter({ hasText: "Analytics Store" })
        .locator("td")
        .nth(1)
        .locator("span.numeric"),
    ).toHaveText("$200.00");
    const row = page
      .locator(".store-navigation-row")
      .filter({ hasText: "Analytics Store" });
    const budgetCell = row.locator("td").nth(1);
    await expect(budgetCell.locator(".comparison-value")).toHaveCount(0);
    await expect(
      budgetCell.getByRole("button", {
        name: "Budget history for Analytics Store",
      }),
    ).toHaveText(
      `Detected ${now.toLocaleDateString("en-IN", { timeZone: "America/New_York", day: "2-digit", month: "short", year: "numeric" })} · Was $150.00`,
    );
    await expect(row.locator(".snapshot-times")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Budget history for Analytics Store" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("$250.00", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      dialog.getByText("$150.00", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      dialog.getByText("Google Ads edit", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("$100.00", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      dialog.getByText(/The saved configuration changed between/),
    ).toBeVisible();
    await page.route("**/api/budget-history", (route) =>
      route.fulfill({
        status: 202,
        json: {
          busy: true,
          message:
            "Another budget history refresh is running. Saved data will update shortly.",
        },
      }),
    );
    await dialog
      .getByRole("button", { name: "Refresh Google history", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "Another budget history refresh is running",
    );
    await expect(
      dialog.getByText("$250.00", { exact: true }).first(),
    ).toBeVisible();
    await page.unroute("**/api/budget-history");
    await dialog.screenshot({ path: "outputs/budget-history.png" });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: /Order flow for Analytics Store:/ })
      .click();
    const chart = page.getByRole("dialog");
    await chart.getByLabel("Choose report date range").click();
    await page
      .locator(".date-preset-list")
      .getByRole("button", { name: "Month to date", exact: true })
      .click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(chart.getByLabel("Compare orders with")).toHaveValue("month");
    await expect(
      chart.getByRole("img", {
        name: "Orders per day for the selected and comparison periods",
      }),
    ).toBeVisible();
    const response = await page.request.get(
      `/api/order-chart?id=${id}&from=${from}&to=${today}&comparison=month`,
    );
    const body = await response.json();
    expect(body.comparisonFrom).toBe(previous.from);
    expect(body.total).toBeGreaterThan(0);
    expect(body.points[0].comparisonDate).toBe(previous.from);
    const curves = chart.locator(".recharts-line-curve");
    await expect(curves).toHaveCount(2);
    expect(await curves.first().getAttribute("stroke-dasharray")).toBeTruthy();
    await chart
      .locator(".recharts-wrapper")
      .hover({ position: { x: 350, y: 140 } });
    await expect(chart.locator(".shopify-chart-tooltip")).toBeVisible();
    await expect(chart.locator(".shopify-chart-tooltip")).toContainText(
      "Orders",
    );
    await chart.screenshot({ path: "outputs/shopify-order-chart.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(chart).toBeVisible();
    await expect
      .poll(async () => (await chart.boundingBox())!.width)
      .toBeLessThanOrEqual(390);
    const bounds = await chart.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    await chart.screenshot({ path: "outputs/shopify-order-chart-mobile.png" });
    expect(errors).toEqual([]);
  } finally {
    await sql`DELETE FROM stores WHERE id=${id}`;
    await sql`DELETE FROM settings WHERE key='owner_password'`;
    await sql.end();
  }
});
