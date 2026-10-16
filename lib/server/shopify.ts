import { recordHealth, shopAuthFailure } from "./connection-health";
import { decrypt } from "./crypto";
import { fetchJson } from "./http";
import { dateInZone, normalizeDomain, numberOrNull } from "../reporting";
import { reportDates } from "../report-ranges";
import type { ShopReport } from "../types";
export type ShopCredentials = {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
};
export const SHOP_QUERY = `query StoreReport($query: String!) { shop { name currencyCode ianaTimezone } shopifyqlQuery(query: $query) { tableData { columns { name dataType displayName } rows } parseErrors } }`;
export async function shopAccess(domain: string, credentials: ShopCredentials) {
  domain = normalizeDomain(domain);
  if (credentials.accessToken) return credentials.accessToken;
  if (!credentials.clientId || !credentials.clientSecret)
    throw new Error("Connect this Shopify store in its details.");
  try {
    const response = await fetchJson(
      `https://${domain}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }),
      },
    );
    if (!response.access_token)
      throw new Error(
        "Shopify access was not granted. Check the app is installed in the same organization.",
      );
    return response.access_token as string;
  } catch (error) {
    const health = shopAuthFailure(error);
    await recordHealth("shop", domain, health.status, health.message);
    throw new Error(health.message);
  }
}
export async function shopGraphql(
  domain: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
) {
  domain = normalizeDomain(domain);
  try {
    const data = await fetchJson(
      `https://${domain}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    if (data.errors?.length) {
      const accessDenied = data.errors.some(
        (error: { extensions?: { code?: string } }) =>
          error.extensions?.code === "ACCESS_DENIED",
      );
      throw new Error(
        accessDenied
          ? "Shopify permissions are missing. Check the installed app’s read_reports/read_products scopes and protected customer data access."
          : "Shopify could not complete this query. Check reporting access and API support.",
      );
    }
    await recordHealth(
      "shop",
      domain,
      "healthy",
      "Shopify authorization verified.",
    );
    return data.data;
  } catch (error) {
    const health = shopAuthFailure(error);
    await recordHealth("shop", domain, health.status, health.message);
    throw new Error(health.message);
  }
}
export async function fetchShop(
  store: { domain: string; shop_cipher: string | null },
  offset: number,
  customDate?: string,
  endDate?: string,
): Promise<ShopReport> {
  if (!store.shop_cipher)
    throw new Error("Connect this Shopify store to fetch sales.");
  const token = await shopAccess(
    store.domain,
    decrypt<ShopCredentials>(store.shop_cipher),
  );
  const metadata = await shopGraphql(
    store.domain,
    token,
    "query { shop { currencyCode ianaTimezone } }",
  );
  const date = customDate || dateInZone(metadata.shop.ianaTimezone, offset);
  const lastDate = endDate || date;
  const data = await shopGraphql(store.domain, token, SHOP_QUERY, {
    query: `FROM sales SHOW total_sales, orders SINCE ${date} UNTIL ${lastDate}`,
  });
  const report = data.shopifyqlQuery;
  if (report.parseErrors?.length)
    throw new Error(
      "Shopify could not run the sales report. Verify reporting access and query support.",
    );
  const row = report.tableData?.rows?.[0];
  const result: ShopReport = {
    sales: numberOrNull(row?.total_sales),
    orders: numberOrNull(row?.orders),
    currency: data.shop.currencyCode,
    timezone: data.shop.ianaTimezone,
    date: date === lastDate ? date : `${date} – ${lastDate}`,
    fetchedAt: new Date().toISOString(),
    raw: report.tableData,
  };
  if (date !== lastDate) {
    const daily = await shopGraphql(store.domain, token, SHOP_QUERY, {
      query: `FROM sales SHOW total_sales, orders TIMESERIES day SINCE ${date} UNTIL ${lastDate} ORDER BY day ASC LIMIT 1000`,
    });
    if (daily.shopifyqlQuery.parseErrors?.length)
      throw new Error("Shopify could not run the daily sales report.");
    const rows = daily.shopifyqlQuery.tableData?.rows;
    if (!Array.isArray(rows))
      throw new Error("Shopify did not return daily sales data.");
    const dailyReports = reportDates(date, lastDate).map((day): ShopReport => {
      const row = rows.find((r: any) => r.day === day);
      if (!row) throw new Error(`Shopify did not return sales for ${day}.`);
      return {
        ...result,
        date: day,
        sales: numberOrNull(row.total_sales),
        orders: numberOrNull(row.orders),
        raw: row,
      };
    });
    result.raw = { tableData: report.tableData, dailyReports };
  }
  return result;
}
