import { db } from "./db";
import { adsQuery, googleAccess } from "./google";
import { dateInZone, micros } from "../reporting";
import {
  activeBudget,
  campaignActivity,
  campaignChangesQuery,
  configuredCampaignQuery,
} from "../campaign-activity";

export function parseBudgetEvents(rows: any[]) {
  return rows.flatMap((row) => {
    const event = row.changeEvent;
    const paths =
      typeof event?.changedFields === "string"
        ? event.changedFields.split(",")
        : event?.changedFields?.paths || [];
    if (
      !event ||
      event.resourceChangeOperation !== "UPDATE" ||
      !paths.some((path: string) =>
        ["amount_micros", "amountMicros"].includes(path),
      )
    )
      return [];
    const budgetId = event.changeResourceName?.match(
      /\/campaignBudgets\/(\d+)$/,
    )?.[1];
    const microsAt = event.resourceName?.match(/\/changeEvents\/(\d+)~/)?.[1];
    const before = event.oldResource?.campaignBudget;
    const after = event.newResource?.campaignBudget;
    if (!budgetId || !microsAt || !before || !after) return [];
    const previous = micros(before.amountMicros ?? 0),
      amount = micros(after.amountMicros ?? 0);
    const at = new Date(Number(BigInt(microsAt) / BigInt(1000)));
    if (
      previous == null ||
      amount == null ||
      previous === amount ||
      !Number.isFinite(at.getTime())
    )
      return [];
    return [
      {
        id: event.resourceName as string,
        budgetId,
        previous,
        amount,
        changedAt: at.toISOString(),
      },
    ];
  });
}

// Cached enrichment is separate from reports: quota or access failures must never
// erase successful report data or block dashboard reads. Five accounts per batch.
export async function refreshBudgetHistory(
  options: { storeId?: string; background?: boolean } = {},
) {
  const background = options.background ?? true;
  const sql = await db().reserve();
  let acquired = false;
  try {
    const [lock] = await sql`SELECT pg_try_advisory_lock(734057) AS acquired`;
    acquired = lock.acquired;
    if (!acquired) return { busy: true, updated: 0 };
    const stores =
      await sql`SELECT s.id,s.group_id,s.cid,s.manager_cid,b.currency,b.timezone FROM budget_states b JOIN stores s ON s.id=b.store_id JOIN google_connections g ON g.group_id=s.group_id WHERE (${options.storeId || null}::uuid IS NULL OR s.id=${options.storeId || null}::uuid) AND (${!!options.storeId} OR b.history_next_at<=now()) ORDER BY b.history_next_at,s.name LIMIT 5`;
    const tokens = new Map<
      number,
      Awaited<ReturnType<typeof googleAccess>> | Error
    >();
    for (const store of stores) {
      try {
        if (!tokens.has(store.group_id)) {
          try {
            tokens.set(
              store.group_id,
              await googleAccess(store.group_id, sql, background),
            );
          } catch (error) {
            tokens.set(store.group_id, error as Error);
          }
        }
        const auth = tokens.get(store.group_id)!;
        if (auth instanceof Error) throw auth;
        const from = dateInZone(store.timezone, -29),
          to = dateInZone(store.timezone, 1);
        const startedAt = new Date().toISOString();
        const rows = await adsQuery(
          store.cid,
          store.manager_cid,
          auth,
          campaignChangesQuery(from, to, true),
        );
        for (const event of parseBudgetEvents(rows)) {
          await sql`INSERT INTO google_budget_events(store_id,event_id,budget_id,previous_amount,amount,changed_at,currency,timezone) VALUES(${store.id},${event.id},${event.budgetId},${event.previous},${event.amount},${event.changedAt},${store.currency},${store.timezone}) ON CONFLICT DO NOTHING`;
        }
        const configured = await adsQuery(
          store.cid,
          store.manager_cid,
          auth,
          configuredCampaignQuery,
        );
        const activity = campaignActivity(
          configured,
          rows,
          store.timezone,
          new Date().toISOString(),
        );
        if (!activity.complete)
          throw Error(
            "Campaign change history was incomplete. Existing reports have been kept.",
          );
        await sql`UPDATE budget_states SET campaign_activity=${sql.json(activity)} WHERE store_id=${store.id} AND (campaign_activity IS NULL OR campaign_activity->>'at'<${activity.at})`;
        // Archive eligibility while the provider's 30-day history is available.
        // Updating metadata does not change report freshness or source totals.
        const daily =
          await sql`SELECT report_date::text,payload FROM reports WHERE store_id=${store.id} AND source='ads' AND payload IS NOT NULL AND report_date>=${activity.from}::date AND report_date<=${dateInZone(store.timezone)}::date`;
        for (const day of daily) {
          const result = activeBudget(
            { ...day.payload, date: day.report_date },
            activity,
          );
          if (!result.complete) continue;
          const eligibility = {
            budgetIds: result.budgetIds,
            complete: true,
            from: day.report_date,
            to: day.report_date,
          };
          await sql`UPDATE reports SET payload=jsonb_set(payload,'{budgetEligibility}',${sql.json(eligibility)}) WHERE store_id=${store.id} AND source='ads' AND report_date=${day.report_date}::date AND payload->>'fetchedAt'=${day.payload.fetchedAt}`;
        }
        await sql`UPDATE budget_states SET history_checked_at=clock_timestamp(),history_error=NULL,history_next_at=CASE WHEN changed_at>=${startedAt}::timestamptz OR changed_at>clock_timestamp()-INTERVAL '3 minutes' THEN GREATEST(clock_timestamp(),changed_at+INTERVAL '3 minutes') ELSE clock_timestamp()+INTERVAL '24 hours' END WHERE store_id=${store.id}`;
      } catch (error) {
        await sql`UPDATE budget_states SET history_error=${error instanceof Error ? error.message : "Budget history could not be refreshed."},history_next_at=clock_timestamp()+INTERVAL '1 hour' WHERE store_id=${store.id}`;
      }
    }
    return { busy: false, updated: stores.length };
  } finally {
    try {
      if (acquired) await sql`SELECT pg_advisory_unlock(734057)`;
    } finally {
      sql.release();
    }
  }
}
