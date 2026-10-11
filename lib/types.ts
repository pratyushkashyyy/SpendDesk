export type Period =
  "today" | "yesterday" | "last7" | "last30" | "monthToDate" | "custom";
export type Budget = {
  id: string;
  name: string;
  amount: number | null;
  shared: boolean;
  period: string;
  campaigns: string[];
};
export type Campaign = {
  id: string;
  name: string;
  status: string;
  spend: number | null;
  budgetId: string;
  targetCpa: number | null;
  biddingStrategy: string;
};
export type AdsAlert = {
  campaignId: string;
  campaignName: string;
  adName: string;
  status: string;
  details: string[];
};
export type CatalogProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  image: string | null;
  variants: { id: string; title: string; sku: string | null; price: string }[];
};
export type CampaignDetail = Campaign & {
  channel: string;
  clicks: number | null;
  impressions: number | null;
  conversions: number | null;
  budget: number | null;
  budgetPeriod: string;
  sharedBudget: boolean;
  targetCpa: number | null;
  biddingStrategy: string;
};
export type ProductPerformance = {
  itemId: string;
  title: string;
  campaignId: string;
  spend: number | null;
  clicks: number | null;
  impressions: number | null;
  conversions: number | null;
};
export type CampaignDay = {
  campaignId: string;
  date: string;
  spend: number | null;
  clicks: number | null;
  impressions: number | null;
  conversions: number | null;
};
export type StoreProductsData = {
  campaignDaily?: CampaignDay[];
  products: CatalogProduct[];
  campaigns: CampaignDetail[];
  performance: ProductPerformance[];
  links: { productId: string; campaignId: string }[];
  date: string;
  currency: string;
  timezone: string;
  catalogError: string | null;
  adsError: string | null;
  fetchedAt: string;
};
export type AdsReport = {
  spend: number | null;
  purchases: number | null;
  costPerPurchase: number | null;
  costNote: string;
  currency: string;
  timezone: string;
  budgets: Budget[];
  campaigns: Campaign[];
  alerts: AdsAlert[];
  fetchedAt: string;
  date: string;
  raw: unknown;
};
export type ShopReport = {
  sales: number | null;
  orders: number | null;
  currency: string;
  timezone: string;
  fetchedAt: string;
  date: string;
  raw: unknown;
};
export type Store = {
  id: string;
  name: string;
  domain: string;
  cid: string;
  group: number;
  managerCid: string;
  shopConnected: boolean;
  ads: AdsReport | null;
  shop: ShopReport | null;
  adsError: string | null;
  shopError: string | null;
};
export type DashboardData = {
  stores: Store[];
  google: { group: number; email: string; connected: boolean }[];
  configured: boolean;
  database: boolean;
  sync?: {
    running: boolean;
    startedAt: string;
    finishedAt?: string;
    synced: number;
    errors: number;
    failed?: boolean;
  };
  error?: string;
};
