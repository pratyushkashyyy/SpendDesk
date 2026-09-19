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
    const [stores, connections, reports] = await Promise.all([
      db()`SELECT id,name,domain,cid,group_id,manager_cid,(shop_cipher IS NOT NULL) AS shop_connected FROM stores ORDER BY name`,
      db()`SELECT group_id,email FROM google_connections ORDER BY group_id`,
      range && from !== to
        ? db()`SELECT store_id,source,(start_date::text || ' – ' || end_date::text) AS report_date,payload,error,checked_at FROM report_ranges WHERE start_date=${from!}::date AND end_date=${to!}::date ORDER BY checked_at DESC`
        : db()`SELECT store_id,source,report_date::text,payload,error,checked_at FROM reports WHERE report_date >= CURRENT_DATE - INTERVAL '5 days' OR report_date=${from || custom || "1900-01-01"}::date ORDER BY checked_at DESC`,
    ]);
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
      return {
        id: store.id,
        name: store.name,
        domain: store.domain,
        cid: store.cid,
        group: store.group_id,
        managerCid: store.manager_cid,
        shopConnected: store.shop_connected,
        ads: strip(ads?.payload),
        shop: strip(shop?.payload),
        adsError: ads?.error || null,
        shopError: shop?.error || null,
      };
    });
    const storedSync = JSON.parse((await getSetting("sync_status")) || "null");
    if (storedSync?.running) {
      const [lock] =
        await db()`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=734052 AND granted) AS running`;
      if (!lock.running) {
        storedSync.running = false;
        storedSync.failed = true;
      }
    }
    return Response.json(
      {
        stores: mapped,
        google: connections.map((c) => ({
          group: c.group_id,
          email: c.email,
          connected: true,
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
