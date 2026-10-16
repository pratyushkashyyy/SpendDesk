import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { randomBytes, createHash } from "node:crypto";
import { hashPassword } from "../../lib/server/crypto";
for (const allowRefresh of [false, true]) {
  test(`ChatGPT owner connection with ${allowRefresh ? "refresh" : "read-only"} permission`, async ({
    page,
    request,
  }) => {
    if (!process.env.TEST_DATABASE_URL?.endsWith("/storedesk_browser_test"))
      throw new Error("Isolated browser database required.");
    const sql = postgres(process.env.TEST_DATABASE_URL);
    const password = "mcp-browser-owner-passphrase";
    try {
      await sql`INSERT INTO settings(key,value) VALUES('owner_password',${hashPassword(password)}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
      const registration = await request.post("/api/mcp/oauth/register", {
        data: {
          redirect_uris: [
            "https://chatgpt.com/connector_platform_oauth_redirect",
          ],
        },
      });
      expect(registration.status()).toBe(201);
      const { client_id } = await registration.json();
      const verifier = randomBytes(32).toString("base64url");
      const query = new URLSearchParams({
        client_id,
        redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
        response_type: "code",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        scope: allowRefresh
          ? "dashboard:read dashboard:refresh"
          : "dashboard:read",
        state: "browser-test-state",
        resource: "http://127.0.0.1:3100/mcp",
      });
      await page.route(
        "https://chatgpt.com/connector_platform_oauth_redirect**",
        (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "Connection complete",
          }),
      );
      await page.goto(`/mcp/authorize?${query}`);
      await page.getByLabel("Dashboard password").fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Connect to ChatGPT" }),
      ).toBeVisible();
      const consentResponse = page.waitForResponse((r) =>
        r.url().endsWith("/api/mcp/oauth/authorize"),
      );
      await page
        .getByRole("button", {
          name: allowRefresh
            ? "Allow access and report refresh"
            : "Allow read-only access",
        })
        .click();
      const consent = await consentResponse;
      expect(consent.status()).toBe(200);
      await expect(page).toHaveURL(
        /https:\/\/chatgpt.com\/connector_platform_oauth_redirect\?/,
      );
      const callback = new URL(page.url());
      expect(callback.searchParams.get("state")).toBe("browser-test-state");
      const token = await request.post("/api/mcp/oauth/token", {
        form: {
          grant_type: "authorization_code",
          client_id,
          code: callback.searchParams.get("code")!,
          redirect_uri: query.get("redirect_uri")!,
          resource: query.get("resource")!,
          code_verifier: verifier,
        },
      });
      expect(token.status()).toBe(200);
      const { access_token } = await token.json();
      const tools = await request.post("/mcp", {
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: "application/json, text/event-stream",
        },
        data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      });
      expect(tools.status()).toBe(200);
      expect((await tools.json()).result.tools).toHaveLength(5);
      const refresh = await request.post("/mcp", {
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: "application/json, text/event-stream",
        },
        data: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "refresh_data",
            arguments: { from: "2026-10-10", to: "2026-10-10" },
          },
        },
      });
      expect(refresh.status()).toBe(200);
      const refreshed = (await refresh.json()).result;
      if (!allowRefresh) {
        expect(refreshed.isError).toBe(true);
        expect(refreshed._meta["mcp/www_authenticate"][0]).toContain(
          "dashboard:refresh",
        );
        expect(
          (await sql`SELECT value FROM settings WHERE key='mcp_refresh_status'`)
            .length,
        ).toBe(0);
      } else {
        expect(refreshed.structuredContent.accepted).toBe(true);
        const requestId = refreshed.structuredContent.requestId;
        await expect
          .poll(async () => {
            const status = await request.post("/mcp", {
              headers: {
                Authorization: `Bearer ${access_token}`,
                Accept: "application/json, text/event-stream",
              },
              data: {
                jsonrpc: "2.0",
                id: 4,
                method: "tools/call",
                params: { name: "get_sync_status", arguments: {} },
              },
            });
            const result = (await status.json()).result.structuredContent;
            expect(Array.isArray(result.comparisonHistory)).toBe(true);
            expect(result.refresh.requestId).toBe(requestId);
            return result.refresh.state;
          })
          .toBe("completed");
      }
    } finally {
      await sql.end();
    }
  });
}
