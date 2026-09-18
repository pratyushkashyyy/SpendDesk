export type Period = "yesterday" | "today" | "custom";
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
