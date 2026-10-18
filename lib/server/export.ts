import { savedReports } from "./report-cache";
import { db } from "./db";
import { storeProducts } from "./store-products";
import { matchProduct } from "../product-matching";
const columns = [
  "Record type",
  "Start date",
  "End date",
  "Google login",
  "Ads CID",
  "Manager CID",
  "Store",
  "Shopify domain",
  "Currency",
  "Time zone",
  "Name / label",
  "Record ID",
  "Status",
  "Channel",
  "Spend",
  "Shopify orders",
  "Google purchases",
  "Cost per purchase",
  "Daily budget",
  "Budget period",
  "Shared budget",
  "Clicks",
  "Impressions",
  "Conversions",
  "Cost / conversion",
  "Product item ID / SKU",
  "Shopify product ID",
  "Source error",
  "Updated at",
] as const;
type Row = Record<(typeof columns)[number], unknown>;
const blank = () => Object.fromEntries(columns.map((c) => [c, ""])) as Row;
function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function csv(rows: Row[]) {
  return (
    "\uFEFF" +
    [columns, ...rows.map((row) => columns.map((c) => row[c]))]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
export async function buildExport(from: string, to: string) {
  try {
    const [stores, connections, reports] = await Promise.all([
      db()`SELECT * FROM stores ORDER BY group_id,name`,
      db()`SELECT group_id,email FROM google_connections ORDER BY group_id`,
      savedReports(from, to),
    ]);
    const byReport = (storeId: string, source: string) =>
      reports.find((r) => r.store_id === storeId && r.source === source);
    const missing = stores.filter(
      (s) =>
        !byReport(s.id, "ads") || (s.shop_cipher && !byReport(s.id, "shop")),
    );
    if (missing.length)
      return Response.json(
        {
          error:
            "The selected report is still refreshing. Wait for it to finish, then export again.",
        },
        { status: 409 },
      );
    // Keep capacity available for dashboard reads while products are prepared.
    const productData: Awaited<ReturnType<typeof storeProducts>>[] = [];
    for (let offset = 0; offset < stores.length; offset += 2) {
      const batch = await Promise.all(
        stores.slice(offset, offset + 2).map(async (store) => {
          const ads = byReport(store.id, "ads")?.payload;
          return storeProducts(
            store,
            from,
            to,
            ads?.currency || "",
            ads?.timezone || "Asia/Kolkata",
          );
        }),
      );
      productData.push(...batch);
    }
    if (productData.some((data) => data.syncComplete === false))
      return Response.json(
        {
          error:
            "Campaign and product reports for these dates are not fully synced yet. Run sync, then export again.",
        },
        { status: 409 },
      );
    const rows: Row[] = [];
    for (const connection of connections) {
      const row = blank();
      Object.assign(row, {
        "Record type": "Google account",
        "Start date": from,
        "End date": to,
        "Google login": connection.email,
        "Record ID": connection.group_id,
      });
      rows.push(row);
    }
    for (let index = 0; index < stores.length; index++) {
      const store = stores[index],
        adsRow = byReport(store.id, "ads"),
        shopRow = byReport(store.id, "shop"),
        ads = adsRow?.payload,
        shop = shopRow?.payload,
        products = productData[index],
        email =
          connections.find((c) => c.group_id === store.group_id)?.email || "";
      const base = {
        "Start date": from,
        "End date": to,
        "Google login": email,
        "Ads CID": store.cid,
        "Manager CID": store.manager_cid,
        Store: store.name,
        "Shopify domain": store.domain,
        Currency: ads?.currency || shop?.currency || "",
        "Time zone": ads?.timezone || shop?.timezone || "",
      };
      const summary = blank();
      Object.assign(summary, base, {
        "Record type": "Store summary",
        "Name / label": store.name,
        "Record ID": store.id,
        Spend: ads?.spend,
        "Shopify orders": shop?.orders,
        "Google purchases": ads?.purchases,
        "Cost per purchase": ads?.costPerPurchase,
        "Source error": [adsRow?.error, shopRow?.error]
          .filter(Boolean)
          .join(" | "),
        "Updated at": adsRow?.checked_at || shopRow?.checked_at,
      });
      rows.push(summary);
      for (const budget of ads?.budgets || []) {
        const row = blank();
        Object.assign(row, base, {
          "Record type": "Budget",
          "Name / label": budget.name,
          "Record ID": budget.id,
          "Daily budget": budget.amount,
          "Budget period": budget.period,
          "Shared budget": budget.shared ? "Yes" : "No",
          Channel: (budget.campaigns || []).join(" | "),
          "Updated at": adsRow?.checked_at,
        });
        rows.push(row);
      }
      for (const campaign of products.campaigns) {
        const row = blank();
        Object.assign(row, base, {
          "Record type": "Campaign",
          "Name / label": campaign.name,
          "Record ID": campaign.id,
          Status: campaign.status,
          Channel: campaign.channel,
          Spend: campaign.spend,
          "Daily budget": campaign.budget,
          "Budget period": campaign.budgetPeriod,
          "Shared budget": campaign.sharedBudget ? "Yes" : "No",
          Clicks: campaign.clicks,
          Impressions: campaign.impressions,
          Conversions: campaign.conversions,
          "Cost / conversion": campaign.costPerConversion,
          "Source error": products.adsError,
          "Updated at": products.fetchedAt,
        });
        rows.push(row);
      }
      for (const product of products.products)
        for (const variant of product.variants) {
          const row = blank();
          Object.assign(row, base, {
            "Record type": "Shopify product",
            "Name / label":
              variant.title === "Default Title"
                ? product.title
                : `${product.title} · ${variant.title}`,
            "Record ID": variant.id,
            Status: product.status,
            "Product item ID / SKU": variant.sku || "",
            "Shopify product ID": product.id,
            "Source error": products.catalogError,
            "Updated at": products.fetchedAt,
          });
          rows.push(row);
        }
      for (const performance of products.performance) {
        const productId = matchProduct(performance.itemId, products.products);
        const row = blank();
        Object.assign(row, base, {
          "Record type": "Product ad activity",
          "Name / label": performance.title,
          "Record ID": performance.campaignId,
          Spend: performance.spend,
          Clicks: performance.clicks,
          Impressions: performance.impressions,
          Conversions: performance.conversions,
          "Product item ID / SKU": performance.itemId,
          "Shopify product ID": productId || "Unmatched",
          "Source error": products.adsError,
          "Updated at": products.fetchedAt,
        });
        rows.push(row);
      }
      for (const link of products.links) {
        const row = blank();
        Object.assign(row, base, {
          "Record type": "Manual product campaign link",
          "Name / label":
            products.campaigns.find((c) => c.id === link.campaignId)?.name ||
            "Campaign",
          "Record ID": link.campaignId,
          "Shopify product ID": link.productId,
          "Updated at": products.fetchedAt,
        });
        rows.push(row);
      }
    }
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="spenddesk-${from}-${to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "Could not prepare the report. Check provider connections and try again.",
      },
      { status: 503 },
    );
  }
}
