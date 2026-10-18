import { buildBudgetHistory } from "@/lib/budget-history";
import { activeBudget } from "@/lib/campaign-activity";
import { buildStoreLive } from "@/lib/store-live";
import { googleConfig } from "@/lib/server/google";
import { googleQuotaScope, googleQuotaStatus } from "@/lib/server/google-quota";
import { healthKey } from "@/lib/server/connection-health";
import { resolvedHealth } from "@/lib/connection-health";
import type { ConnectionHealth } from "@/lib/types";
import { after } from "next/server";
import { savedReports } from "@/lib/server/report-cache";
import { syncReports } from "@/lib/server/sync";
import { guard } from "@/lib/server/auth";
import { db, getSetting } from "@/lib/server/db";
import { dateInZone, validDate } from "@/lib/reporting";
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  if (!process.env.DATABASE_URL)
    return Response.json({
      stores: [],
      google: [],
      configured: false,
      database: false,
    });
  try {
    const url = new URL(request.url),
      period = url.searchParams.get("period") || "yesterday",
      custom = url.searchParams.get("date"),
      from = url.searchParams.get("from"),
      to = url.searchParams.get("to");
    const range = !!from || !!to;
    if (
      range &&
      (!from ||
        !to ||
        !validDate(from) ||
        !validDate(to) ||
        from > to ||
        (Date.parse(to) - Date.parse(from)) / 86400000 > 365)
    )
      return Response.json(
        { error: "Choose a valid date range of 366 days or less." },
        { status: 400 },
      );
    if (!["yesterday", "today", "custom"].includes(period))
      return Response.json(
        { error: "Choose Yesterday, Today, or a custom date." },
        { status: 400 },
      );
    if (period === "custom" && !custom)
      return Response.json({ error: "Choose a report date." }, { status: 400 });
    if (custom && !validDate(custom))
      return Response.json({ error: "Choose a valid date." }, { status: 400 });
    const [
      stores,
      connections,
      reports,
      savedHealth,
      latestReports,
      recentReports,
      observations,
      budgetStates,
      budgetEvents,
      budgetObserved,
    ] = await Promise.all([
      db()`SELECT id,name,domain,cid,group_id,manager_cid,(shop_cipher IS NOT NULL) AS shop_connected FROM stores ORDER BY name`,
      db()`SELECT group_id,email FROM google_connections ORDER BY group_id`,
      range
        ? savedReports(from!, to!)
        : db()`SELECT store_id,source,report_date::text,payload,error,checked_at FROM reports WHERE report_date >= CURRENT_DATE - INTERVAL '5 days' OR report_date=${from || custom || "1900-01-01"}::date ORDER BY checked_at DESC`,
      db()`SELECT key,value FROM settings WHERE key LIKE 'connection_health:%'`,
      db()<
        {
          store_id: string;
          source: string;
          error: string | null;
          checked_at: Date;
          available: boolean;
        }[]
      >`SELECT DISTINCT ON (store_id,source) store_id,source,error,checked_at,available FROM (SELECT store_id,source,error,checked_at,(payload IS NOT NULL) AS available FROM reports UNION ALL SELECT store_id,source,error,checked_at,(payload IS NOT NULL) AS available FROM report_ranges) snapshots ORDER BY store_id,source,checked_at DESC`,
      db()`SELECT store_id,source,report_date::text,payload,error FROM reports WHERE report_date >= CURRENT_DATE - INTERVAL '2 days'`,
      db()`SELECT store_id,source,report_date::text,observed_at,payload FROM report_observations WHERE observed_at >= now() - INTERVAL '50 hours' ORDER BY observed_at DESC`,
      db()`SELECT * FROM budget_states`,
      db()`SELECT * FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY store_id ORDER BY changed_at DESC) AS position FROM google_budget_events) events WHERE position<=30`,
      db()`SELECT * FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY store_id ORDER BY observed_at DESC) AS position FROM budget_observed_changes) changes WHERE position<=20`,
    ]);
    const health = new Map<string, ConnectionHealth>(
      savedHealth.map((row) => [row.key, JSON.parse(row.value)]),
    );
    const mapped = stores.map((store) => {
      const report = (source: string) => {
        const relevant = reports.filter(
          (r) => r.store_id === store.id && r.source === source,
        );
        const tz =
          relevant.find((r) => r.payload)?.payload?.timezone || "Asia/Kolkata";
        const date =
          range && from && to
            ? from === to
              ? from
              : `${from} – ${to}`
            : custom || dateInZone(tz, period === "today" ? 0 : -1);
        return relevant.find((r) => r.report_date === date);
      };
      const ads = report("ads"),
        shop = report("shop");
      // Raw provider payloads stay on the server; only display fields leave the API.
      const strip = (value: any) =>
        value
          ? Object.fromEntries(
              Object.entries(value).filter(([k]) => k !== "raw"),
            )
          : null;
      const budgetState = budgetStates.find((row) => row.store_id === store.id);
      return {
        activeBudget: ads?.payload
          ? activeBudget(
              ads.payload,
              budgetState?.campaign_activity,
              budgetState?.budgets,
            )
          : null,
        budgetHistory: budgetState
          ? buildBudgetHistory(
              budgetState as any,
              budgetEvents as any,
              budgetObserved as any,
            )
          : null,
        live: buildStoreLive(
          store.id,
          recentReports as any,
          observations as any,
          store.shop_connected,
        ),
        id: store.id,
        name: store.name,
        domain: store.domain,
        cid: store.cid,
        group: store.group_id,
        managerCid: store.manager_cid,
        shopConnected: store.shop_connected,
        shopHealth: resolvedHealth(
          health.get(healthKey("shop", store.domain)),
          latestReports.find(
            (r) => r.store_id === store.id && r.source === "shop",
          ),
          store.shop_connected,
        ),
        ads: strip(ads?.payload),
        shop: strip(shop?.payload),
        adsError: ads?.error || null,
        shopError: shop?.error || null,
      };
    });
    // Reads reuse durable snapshots; only absent source/date pairs need providers.
    if (from && to) {
      const key = from === to ? from : `${from} – ${to}`;
      const missing = stores.some((store) =>
        ["ads", ...(store.shop_connected ? ["shop"] : [])].some(
          (source) =>
            !reports.some(
              (report) =>
                report.store_id === store.id &&
                report.source === source &&
                report.report_date === key,
            ),
        ),
      );
      if (missing)
        after(async () => {
          try {
            await syncReports(from, to, true);
          } catch {
            console.error("Missing report preparation failed.");
          }
        });
    }
    const storedSync = JSON.parse((await getSetting("sync_status")) || "null");
    if (storedSync?.running) {
      const [lock] =
        await db()`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=0 AND objid=734052 AND granted) AS running`;
      if (!lock.running) {
        storedSync.running = false;
        storedSync.failed = true;
      }
    }
    const connectionCheck = JSON.parse(
      (await getSetting("connection_check_status")) || "null",
    );
    if (connectionCheck?.running) {
      const [lock] =
        await db()`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=0 AND objid=734055 AND granted) AS running`;
      connectionCheck.running = lock.running;
    }
    const config = await getSetting("google_config");
    const googleQuota = config
      ? await googleQuotaStatus(
          googleQuotaScope((await googleConfig()).clientId),
        )
      : null;
    return Response.json(
      {
        googleQuota,
        stores: mapped,
        connectionCheck,
        google: connections.map((c) => ({
          group: c.group_id,
          email: c.email,
          connected: true,
          health: resolvedHealth(
            health.get(healthKey("google", c.group_id)),
            latestReports
              .filter(
                (r) =>
                  r.source === "ads" &&
                  stores.some(
                    (s) => s.id === r.store_id && s.group_id === c.group_id,
                  ),
              )
              .sort(
                (a, b) =>
                  new Date(b.checked_at).getTime() -
                  new Date(a.checked_at).getTime(),
              )[0],
          ),
        })),
        configured: !!(await getSetting("google_config")),
        database: true,
        sync: storedSync,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error:
          "The database is unavailable. Your saved data has not been changed.",
      },
      { status: 503 },
    );
  }
}
