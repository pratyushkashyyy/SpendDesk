import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { encrypt, hashPassword } from "../../lib/server/crypto";
import { dateInZone } from "../../lib/reporting";
test("Connections identifies revoked accounts and stores separately from permission issues", async ({
  page,
  request,
}) => {
  if (!process.env.TEST_DATABASE_URL?.endsWith("/storedesk_browser_test"))
    throw new Error("Isolated database required.");
  const sql = postgres(process.env.TEST_DATABASE_URL);
  const password = "connections-owner-test-passphrase";
  try {
    expect(
      (
        await request.post("/api/connections/check", {
          headers: { Origin: "http://127.0.0.1:3100" },
        })
      ).status(),
    ).toBe(401);
    await sql`INSERT INTO settings(key,value) VALUES('owner_password',${hashPassword(password)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    await sql`INSERT INTO settings(key,value) VALUES('google_config',${encrypt({ clientId: "fixture-client", clientSecret: "fixture-secret" })}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    const now = new Date().toISOString();
    for (const [group, name, status] of [
      [11, "Expired Store", "reauthorization_required"],
      [12, "Permission Store", "attention"],
      [13, "Healthy Store", "healthy"],
    ] as const) {
      await sql`INSERT INTO google_connections(group_id,email,token_cipher) VALUES(${group},${`account${group}@example.test`},${encrypt({ refreshToken: "fixture" })})`;
      const id = randomUUID(),
        domain = `health-${group}.myshopify.com`;
      await sql`INSERT INTO stores(id,name,domain,cid,group_id,shop_cipher) VALUES(${id},${name},${domain},${`12345678${group}`},${group},${encrypt({ accessToken: "fixture" })})`;
      for (const source of ["ads", "shop"])
        await sql`INSERT INTO reports(store_id,source,report_date,error) VALUES(${id},${source},${dateInZone("Asia/Kolkata", -1)}::date,NULL)`;
      for (const [provider, key] of [
        ["google", group],
        ["shop", domain],
      ] as const) {
        const message =
          status === "reauthorization_required"
            ? "Authorization expired. Reconnect this connection."
            : status === "attention"
              ? "Missing reporting permissions. Check access scopes."
              : "Authorization verified.";
        await sql`INSERT INTO settings(key,value) VALUES(${`connection_health:${provider}:${key}`},${JSON.stringify({ status, message, checkedAt: now })})`;
      }
    }
    await page.goto("/login");
    await page.getByLabel("Dashboard password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3100/");
    await page.goto("/?view=connections");
    const expired = page.locator(".connection-card").filter({
      has: page.getByRole("heading", { name: "account11@example.test" }),
    });
    await expect(
      expired.getByText("Reauthorization required", { exact: true }),
    ).toBeVisible();
    await expect(
      expired.getByRole("link", { name: "Reconnect" }),
    ).toHaveAttribute("href", "/api/google/start?group=11");
    const attention = page.locator(".connection-card").filter({
      has: page.getByRole("heading", { name: "account12@example.test" }),
    });
    await expect(
      attention.getByText("Needs attention", { exact: true }),
    ).toBeVisible();
    await expect(
      attention.getByText("Reauthorization required", { exact: true }),
    ).toHaveCount(0);
    const store = page.getByRole("button", { name: /Expired Store/ });
    await expect(
      store.getByText("Shopify · Reauthorization required", { exact: true }),
    ).toBeVisible();
    await expect(
      store.getByText("Google account needs reconnecting", { exact: true }),
    ).toBeVisible();
    const historical = await page.request.get(
      "/api/dashboard?period=custom&date=2000-01-01",
    );
    expect(
      (await historical.json()).google.find(
        (c: { group: number }) => c.group === 11,
      ).health.status,
    ).toBe("reauthorization_required");
    await page.screenshot({
      path: "/tmp/connections-health-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      store.getByText("Shopify · Reauthorization required", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "/tmp/connections-health-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await store.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  } finally {
    await sql`DELETE FROM stores WHERE group_id IN (11,12,13)`;
    await sql`DELETE FROM google_connections WHERE group_id IN (11,12,13)`;
    await sql`DELETE FROM settings WHERE key LIKE 'connection_health:%' OR key IN ('owner_password','google_config')`;
    await sql.end();
  }
});
