import { decrypt } from "./crypto";
import { fetchJson } from "./http";
import { dateInZone, normalizeDomain, numberOrNull } from "../reporting";
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
}
export async function shopGraphql(
  domain: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const data = await fetchJson(
    `https://${normalizeDomain(domain)}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (data.errors?.length)
    throw new Error(
      "Shopify reporting access is unavailable. Check read_reports and protected customer data permissions.",
    );
  return data.data;
}
export async function fetchShop(
  store: { domain: string; shop_cipher: string | null },
  offset: number,
  customDate?: string,
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
  const data = await shopGraphql(store.domain, token, SHOP_QUERY, {
    query: `FROM sales SHOW total_sales, orders SINCE ${date} UNTIL ${date}`,
  });
  const report = data.shopifyqlQuery;
  if (report.parseErrors?.length)
    throw new Error(
      "Shopify could not run the sales report. Verify reporting access and query support.",
    );
  const row = report.tableData?.rows?.[0];
  return {
    sales: numberOrNull(row?.total_sales),
    orders: numberOrNull(row?.orders),
    currency: data.shop.currencyCode,
    timezone: data.shop.ianaTimezone,
    date,
    fetchedAt: new Date().toISOString(),
    raw: report.tableData,
  };
}
