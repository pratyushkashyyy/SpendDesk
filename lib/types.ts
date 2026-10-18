export type GoogleQuotaStatus = {
  used: number;
  limit: number;
  warning: boolean;
  backgroundPaused: boolean;
  exhausted: boolean;
  cooldownUntil: string | null;
  exhaustedUntil: string | null;
  nextReleaseAt: string | null;
  trackedSince: string | null;
};
export type ConnectionHealth = {
  status:
    | "healthy"
    | "reauthorization_required"
    | "attention"
    | "rate_limited"
    | "unchecked"
    | "not_connected";
  message: string;
  checkedAt: string | null;
};
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
  impressions?: number | null;
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
  costPerConversion?: number | null;
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
  costPerConversion?: number | null;
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
  budgetEligibility?: {
    budgetIds: string[];
    complete: boolean;
    from: string;
    to: string;
  };
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
export type OrderFlow = {
  state:
    | "on_pace"
    | "ahead"
    | "slower"
    | "quiet"
    | "no_baseline"
    | "stale"
    | "unavailable"
    | "not_connected";
  todayOrders: number | null;
  yesterdayOrders: number | null;
  percent: number | null;
  asOf: string | null;
  baselineAt: string | null;
  hourlyDelta: number | null;
};
export type ReportPair = {
  ads: AdsReport | null;
  shop: ShopReport | null;
  adsError: string | null;
  shopError: string | null;
};
export type OrderObservation = {
  date: string;
  at: string;
  orders: number;
  minute: number;
};
export type StoreLive = {
  orderHistory?: OrderObservation[];
  today: ReportPair;
  hourAgo: ReportPair;
  orderFlow: OrderFlow;
};
export type BudgetChange = {
  id: string;
  budgetId?: string;
  name: string;
  previous: number | null;
  amount: number | null;
  changedAt: string;
  previousAt?: string;
  source: "google" | "observed";
};
export type BudgetHistory = {
  budgets: Budget[];
  current: number | null;
  previous: number | null;
  changedAt: string | null;
  previousAt: string | null;
  source: "google" | "observed" | null;
  currency: string;
  timezone: string;
  confirmedAt: string;
  checkedAt: string | null;
  error: string | null;
  changes: BudgetChange[];
};
export type Store = {
  activeBudget?: import("./campaign-activity").ActiveBudget | null;
  budgetHistory?: BudgetHistory | null;
  live?: StoreLive;
  id: string;
  name: string;
  domain: string;
  cid: string;
  group: number;
  managerCid: string;
  shopConnected: boolean;
  shopHealth?: ConnectionHealth;
  ads: AdsReport | null;
  shop: ShopReport | null;
  adsError: string | null;
  shopError: string | null;
};
export type DashboardData = {
  googleQuota?: GoogleQuotaStatus | null;
  stores: Store[];
  google: {
    group: number;
    email: string;
    connected: boolean;
    health?: ConnectionHealth;
  }[];
  connectionCheck?: {
    running: boolean;
    checked: number;
    errors: number;
    startedAt: string;
    finishedAt?: string;
  } | null;
  configured: boolean;
  database: boolean;
  sync?: {
    running: boolean;
    startedAt: string;
    finishedAt?: string;
    synced: number;
    errors: number;
    deferred?: number;
    adsPause?: {
      reason: "background" | "exhausted" | "cooldown";
      message: string;
      resumeAt?: string;
    };
    failed?: boolean;
  };
  error?: string;
};
