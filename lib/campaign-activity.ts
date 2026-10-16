import { dateInZone, micros, validDate } from "./reporting";
import type { AdsReport, Budget } from "./types";

type Configuration = {
  status: string;
  budgetId: string;
  startDate?: string;
  endDate?: string;
};
export type CampaignActivity = {
  at: string;
  from: string;
  timezone: string;
  complete: boolean;
  error?: string;
  campaigns: (Configuration & { id: string; name: string })[];
  budgets: Budget[];
  events: {
    id: string;
    campaignId: string;
    at: string;
    operation: string;
    before: Partial<Configuration>;
    after: Partial<Configuration>;
  }[];
};
export type ActiveBudget = {
  amount: number | null;
  budgetIds: string[];
  budgets: Budget[];
  complete: boolean;
  from: string;
  to: string;
  note: string;
};
export const configuredCampaignQuery =
  "SELECT campaign.id, campaign.name, campaign.status, campaign.start_date, campaign.end_date, campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.period FROM campaign WHERE campaign.status IN (ENABLED, PAUSED, REMOVED)";
export function campaignChangesQuery(
  from: string,
  to: string,
  includeBudgets = false,
) {
  if (!validDate(from) || !validDate(to))
    throw Error("Invalid campaign history dates.");
  return `SELECT change_event.resource_name, change_event.change_date_time, change_event.change_resource_name, change_event.changed_fields, change_event.old_resource, change_event.new_resource, change_event.resource_change_operation FROM change_event WHERE change_event.change_resource_type ${includeBudgets ? "IN (CAMPAIGN, CAMPAIGN_BUDGET)" : "= CAMPAIGN"} AND change_event.change_date_time >= '${from}' AND change_event.change_date_time < '${to}' ORDER BY change_event.change_date_time DESC LIMIT 10000`;
}
export function campaignActivity(
  configured: any[],
  rows: any[],
  timezone: string,
  at: string,
  error?: string,
): CampaignActivity {
  const budgets = new Map<string, Budget>();
  const campaigns = configured.flatMap((row) => {
    const c = row.campaign,
      b = row.campaignBudget;
    if (!c?.id || !b?.id) return [];
    const existing = budgets.get(b.id);
    if (existing) existing.campaigns.push(c.name);
    else
      budgets.set(b.id, {
        id: b.id,
        name: b.name,
        amount: b.period === "DAILY" ? micros(b.amountMicros) : null,
        period: b.period,
        shared: !!b.explicitlyShared,
        campaigns: [c.name],
      });
    return [
      {
        id: c.id,
        name: c.name,
        status: c.status,
        budgetId: b.id,
        startDate: c.startDate,
        endDate: c.endDate,
      },
    ];
  });
  let complete = !error && rows.length < 10000;
  const events: CampaignActivity["events"] = [];
  const fields = {
    status: "status",
    campaign_budget: "budgetId",
    campaignBudget: "budgetId",
    start_date: "startDate",
    startDate: "startDate",
    end_date: "endDate",
    endDate: "endDate",
  } as const;
  for (const row of rows) {
    const e = row.changeEvent;
    const campaignId = e?.changeResourceName?.match(/\/campaigns\/(\d+)$/)?.[1];
    if (!campaignId) continue;
    const operation = e.resourceChangeOperation;
    const paths: string[] =
      typeof e.changedFields === "string"
        ? e.changedFields.split(",")
        : e.changedFields?.paths || [];
    const relevant = paths.filter((path) => path in fields);
    if (operation === "UPDATE" && !relevant.length) continue;
    const timestamp = e.resourceName?.match(/\/changeEvents\/(\d+)~/)?.[1];
    if (!timestamp || !["UPDATE", "CREATE", "REMOVE"].includes(operation)) {
      complete = false;
      continue;
    }
    const time = new Date(Number(BigInt(timestamp) / BigInt(1000)));
    if (!Number.isFinite(time.getTime())) {
      complete = false;
      continue;
    }
    const patch = (resource: any): Partial<Configuration> => {
      const c = resource?.campaign;
      if (!c) return {};
      const values: Partial<Configuration> = {};
      for (const path of operation === "UPDATE"
        ? relevant
        : ["status", "campaignBudget", "startDate", "endDate"]) {
        const field = fields[path as keyof typeof fields];
        if (field === "budgetId")
          values.budgetId =
            c.campaignBudget?.match(/\/campaignBudgets\/(\d+)$/)?.[1] || "";
        else if (field) values[field] = c[field] || "";
      }
      return values;
    };
    const before = patch(e.oldResource),
      after = patch(e.newResource);
    if (operation === "REMOVE" && !before.status) complete = false;
    if (
      operation === "UPDATE" &&
      relevant.some(
        (p) =>
          !(fields[p as keyof typeof fields] in before) ||
          !(fields[p as keyof typeof fields] in after),
      )
    )
      complete = false;
    events.push({
      id: e.resourceName,
      campaignId,
      at: time.toISOString(),
      operation,
      before,
      after,
    });
  }
  return {
    at,
    from: dateInZone(timezone, -29, new Date(at)),
    timezone,
    complete,
    error,
    budgets: [...budgets.values()],
    campaigns,
    events,
  };
}

// Find the true UTC boundary of an account-local date, including 23/25-hour DST days.
const boundaries = new Map<string, number>();
function dayStart(day: string, zone: string) {
  const key = `${zone}:${day}`;
  if (boundaries.has(key)) return boundaries.get(key)!;
  let low = Date.parse(day) - 36 * 3600000,
    high = Date.parse(day) + 36 * 3600000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (dateInZone(zone, 0, new Date(mid)) < day) low = mid;
    else high = mid;
  }
  if (boundaries.size > 2000) boundaries.clear();
  boundaries.set(key, high);
  return high;
}
export function eligibleBudgetIds(
  activity: CampaignActivity,
  from: string,
  to: string,
) {
  const start = dayStart(from, activity.timezone);
  const nextDay = new Date(Date.parse(to) + 86400000)
    .toISOString()
    .slice(0, 10);
  const end = Math.min(
    dayStart(nextDay, activity.timezone),
    Date.parse(activity.at),
  );
  const ids = new Set<string>();
  for (const campaign of activity.campaigns) {
    let config: Configuration | null = campaign,
      until = Date.parse(activity.at);
    const add = (since: number) => {
      if (!config || config.status !== "ENABLED" || !config.budgetId) return;
      const scheduledStart =
        config.startDate && validDate(config.startDate)
          ? dayStart(config.startDate, activity.timezone)
          : -Infinity;
      const scheduledEnd =
        config.endDate &&
        validDate(config.endDate) &&
        config.endDate < "2037-12-30"
          ? dayStart(
              new Date(Date.parse(config.endDate) + 86400000)
                .toISOString()
                .slice(0, 10),
              activity.timezone,
            )
          : Infinity;
      if (
        Math.max(start, since, scheduledStart) <
        Math.min(end, until, scheduledEnd)
      )
        ids.add(config.budgetId);
    };
    const events = activity.events
      .filter(
        (e) =>
          e.campaignId === campaign.id &&
          Date.parse(e.at) <= Date.parse(activity.at),
      )
      .sort(
        (a, b) =>
          Date.parse(b.at) - Date.parse(a.at) ||
          b.id.localeCompare(a.id, undefined, { numeric: true }),
      );
    for (const event of events) {
      const at = Date.parse(event.at);
      add(at);
      config =
        event.operation === "CREATE"
          ? null
          : { ...(config || campaign), ...event.before };
      until = at;
    }
    add(dayStart(activity.from, activity.timezone));
  }
  return ids;
}

export function activeBudget(
  report: AdsReport,
  activity?: CampaignActivity | null,
  currentBudgets?: Budget[],
): ActiveBudget {
  const [from, to = from] = report.date.split(" – ");
  const usable =
    activity &&
    activity.timezone === report.timezone &&
    activity.complete &&
    from >= activity.from &&
    to <= dateInZone(activity.timezone, 0, new Date(activity.at));
  const saved = report.budgetEligibility;
  const complete =
    !!usable || !!(saved?.complete && saved.from === from && saved.to === to);
  const ids = usable
    ? eligibleBudgetIds(activity, from, to)
    : new Set(saved?.budgetIds || []);
  // Delivery is positive evidence even during Google's short change-event indexing delay.
  for (const campaign of report.campaigns || [])
    if ((campaign.spend || 0) > 0 || (campaign.impressions || 0) > 0)
      ids.add(campaign.budgetId);
  const configured = new Map<string, Budget>();
  for (const budget of [
    ...report.budgets,
    ...(activity?.budgets || []),
    ...(currentBudgets || []),
  ])
    configured.set(budget.id, budget);
  const budgets = [...ids].flatMap((id) =>
    configured.has(id) ? [configured.get(id)!] : [],
  );
  const amountsKnown =
    budgets.length === ids.size &&
    budgets.every((b) => b.period === "DAILY" && b.amount != null);
  return {
    amount:
      complete && amountsKnown
        ? budgets.reduce((sum, b) => sum + b.amount!, 0)
        : null,
    budgetIds: [...ids],
    budgets,
    complete,
    from,
    to,
    note: !complete
      ? "Campaign pause/resume history is not available for the whole selected period yet. Refresh reports to collect it."
      : !amountsKnown
        ? "A qualifying budget amount is unavailable or is not a daily budget."
        : `Full current daily budgets for campaigns enabled at any time in ${from === to ? from : `${from} – ${to}`} (${report.timezone}). Campaigns paused for the whole period are excluded; shared budgets count once.`,
  };
}
