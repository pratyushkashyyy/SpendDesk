import { savedReports } from "./report-cache";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db, getSetting } from "./db";
import { scope, refreshScope, challenge } from "./mcp-oauth";
import {
  getRefreshStatus,
  requestRefresh,
  type ScheduleRefresh,
} from "./mcp-refresh";
import { validDate } from "../reporting";

const instructions =
  "SpendDesk reports are saved source snapshots, not necessarily live. Always state report dates, source time zones, currencies, checkedAt and errors. Missing data is unavailable, never zero. Never sum different currencies. Budgets are current configuration, not historical spending. Google purchase conversions may be fractional. Do not invent ROAS, profit or blended CPA. Ranges may use complete saved daily coverage in the same currency and time zone. Cost per purchase is unavailable on combined ranges unless refreshed from the provider. For missing or stale reports, offer refresh_data when requested by the owner. Refresh runs in the background: check get_sync_status for the returned requestId, and only claim completion after its state is completed. If errors are nonzero, describe the source failures. Refresh updates store reports; product catalog/performance snapshots still require refreshing the product workspace in the dashboard.";
export function cleanPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanPayload);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["raw", "sales", "total_sales"].includes(key))
        .map(([key, v]) => [key, cleanPayload(v)]),
    );
  return value;
}
export function validateRange(from: string, to: string) {
  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 365
  )
    throw new Error("Choose a valid inclusive range of at most 366 days.");
}
const date = z.string().refine(validDate, "Use YYYY-MM-DD.");
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const meta = { securitySchemes: [{ type: "oauth2", scopes: [scope] }] };
function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}
export function createMcpServer(
  options: { scopes?: string[]; scheduleRefresh?: ScheduleRefresh } = {},
) {
  const server = new McpServer(
    { name: "SpendDesk", version: "1.1.0" },
    { instructions },
  );
  server.registerTool(
    "list_stores",
    {
      description:
        "List connected SpendDesk stores and their report identifiers. No credentials are returned.",
      inputSchema: {},
      annotations,
      _meta: meta,
    },
    async () =>
      result({
        stores:
          await db()`SELECT id,name,domain,cid,(shop_cipher IS NOT NULL) AS shop_connected FROM stores ORDER BY name`,
      }),
  );
  server.registerTool(
    "get_store_reports",
    {
      description:
        "Read exact saved Google Ads and Shopify order reports for an inclusive date range, including campaign spend, budgets, purchase conversions and source errors. Use list_stores to resolve store_id. Omit store_id for all stores. Missing reports are unavailable; this tool does not refresh providers.",
      inputSchema: {
        from: date,
        to: date,
        store_id: z.string().uuid().optional(),
      },
      annotations,
      _meta: meta,
    },
    async ({ from, to, store_id }) => {
      validateRange(from, to);
      const stores =
        await db()`SELECT id,name,domain FROM stores WHERE (${store_id || null}::uuid IS NULL OR id=${store_id || null}::uuid) ORDER BY name`;
      const reports = (await savedReports(from, to)).filter(
        (r) => !store_id || r.store_id === store_id,
      );
      return result({
        from,
        to,
        rules: instructions,
        stores: stores.map((s) => ({
          ...s,
          sources: ["ads", "shop"].map((source) => {
            const r = reports.find(
              (r) => r.store_id === s.id && r.source === source,
            );
            return {
              source,
              available: !!r?.payload,
              checkedAt: r?.checked_at || null,
              stale:
                !r || Date.now() - new Date(r.checked_at).getTime() > 3600000,
              error: r?.error || null,
              data: cleanPayload(r?.payload || null),
            };
          }),
        })),
      });
    },
  );
  server.registerTool(
    "get_product_performance",
    {
      description:
        "Read saved Shopify catalog and Google product/campaign performance for one store and exact date range. Returns bounded pages of products, campaigns, product performance and daily campaign data. Missing snapshots require preparation in the dashboard.",
      inputSchema: {
        store_id: z.string().uuid(),
        from: date,
        to: date,
        offset: z.number().int().min(0).max(100000).default(0),
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations,
      _meta: meta,
    },
    async ({ store_id, from, to, offset, limit }) => {
      validateRange(from, to);
      const [snapshot] =
        await db()`SELECT payload,checked_at FROM store_product_snapshots WHERE store_id=${store_id}::uuid AND start_date=${from}::date AND end_date=${to}::date`;
      if (!snapshot)
        return result({
          available: false,
          store_id,
          from,
          to,
          message:
            "This exact range has no saved product snapshot. Open the store in the dashboard for these dates to prepare it.",
        });
      const p = snapshot.payload;
      const lists = Object.fromEntries(
        ["products", "campaigns", "performance", "campaignDaily", "links"].map(
          (key) => {
            const items = Array.isArray(p[key]) ? p[key] : [];
            return [
              key,
              {
                items: cleanPayload(items.slice(offset, offset + limit)),
                total: items.length,
                nextOffset:
                  offset + limit < items.length ? offset + limit : null,
              },
            ];
          },
        ),
      );
      return result({
        available: true,
        store_id,
        from,
        to,
        checkedAt: snapshot.checked_at,
        stale: Date.now() - new Date(snapshot.checked_at).getTime() > 3600000,
        currency: p.currency,
        timezone: p.timezone,
        catalogError: p.catalogError,
        adsError: p.adsError,
        offset,
        limit,
        ...lists,
      });
    },
  );
  server.registerTool(
    "get_sync_status",
    {
      description:
        "Read dashboard sync progress and the last MCP refresh request status. Match requestId, and do not treat queued/running/paused/busy/failed as completed. Deferred Ads reports were not refreshed because of quota; Shopify can still update.",
      inputSchema: {},
      annotations,
      _meta: meta,
    },
    async () =>
      result({
        sync: JSON.parse((await getSetting("sync_status")) || "null"),
        refresh: await getRefreshStatus(),
        comparisonHistory:
          await db()`SELECT s.name,r.source,count(*)::int AS snapshots,
          min(r.observed_at) AS first_observed_at,max(r.observed_at) AS last_observed_at
          FROM report_observations r JOIN stores s ON s.id=r.store_id
          WHERE r.observed_at >= now() - INTERVAL '50 hours'
          GROUP BY s.id,s.name,r.source ORDER BY s.name,r.source`,
        budgetHistory:
          await db()`SELECT s.name,b.history_checked_at AS checked_at,b.history_error AS error,
          b.campaign_activity->>'at' AS campaign_activity_at,
          b.campaign_activity->>'complete' AS campaign_activity_complete,
          (SELECT count(*)::int FROM google_budget_events e WHERE e.store_id=b.store_id) AS google_changes,
          (SELECT count(*)::int FROM budget_observed_changes c WHERE c.store_id=b.store_id) AS saved_changes
          FROM budget_states b JOIN stores s ON s.id=b.store_id ORDER BY s.name`,
        rules: instructions,
      }),
  );
  server.registerTool(
    "refresh_data",
    {
      title: "Refresh dashboard reports",
      description:
        "Request fresh Google Ads and Shopify order reports for all connected stores. Omit dates for today and the preceding three days in each source account time zone, or provide both from and to for an exact inclusive range of at most 366 days. Runs in the background and returns a requestId; use get_sync_status until that request is completed, then get_store_reports. Uses provider API quota and updates saved report snapshots. Does not change campaigns/budgets/settings or refresh product workspace snapshots. Only use when the owner asks to refresh.",
      inputSchema: { from: date.optional(), to: date.optional() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: [scope, refreshScope] }],
      },
    },
    async ({ from, to }) => {
      if (!(options.scopes || []).includes(refreshScope))
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Reconnect SpendDesk and allow report refresh permission.",
            },
          ],
          _meta: {
            "mcp/www_authenticate": [
              `${challenge(`${scope} ${refreshScope}`)}, error="insufficient_scope"`,
            ],
          },
        };
      if (!!from !== !!to)
        throw new Error("Provide both from and to, or omit both dates.");
      if (from && to) validateRange(from, to);
      if (!options.scheduleRefresh)
        throw new Error("Refresh scheduling is unavailable.");
      return result(await requestRefresh(from, to, options.scheduleRefresh));
    },
  );
  return server;
}
