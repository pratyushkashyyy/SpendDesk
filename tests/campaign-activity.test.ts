import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeBudget,
  campaignActivity,
  eligibleBudgetIds,
  configuredCampaignQuery,
} from "../lib/campaign-activity";
import type { AdsReport } from "../lib/types";

const at = "2026-10-16T16:00:00Z";
const configured = (
  id: string,
  status: string,
  budgetId = id,
  startDate = "2026-01-01",
  endDate = "2037-12-30",
) => ({
  campaign: { id, name: `Campaign ${id}`, status, startDate, endDate },
  campaignBudget: {
    id: budgetId,
    name: `Budget ${budgetId}`,
    amountMicros: "100000000",
    period: "DAILY",
    explicitlyShared: budgetId === "shared",
  },
});
const event = (
  id: string,
  time: string,
  oldStatus: string,
  status: string,
  operation = "UPDATE",
) => ({
  changeEvent: {
    resourceName: `customers/1/changeEvents/${BigInt(Date.parse(time)) * BigInt(1000)}~0~0`,
    changeResourceName: `customers/1/campaigns/${id}`,
    resourceChangeOperation: operation,
    changedFields: "status",
    oldResource: { campaign: { status: oldStatus } },
    newResource: { campaign: { status } },
  },
});
test("v25 campaign configuration uses supported date-time fields and preserves short serving windows", () => {
  assert.match(configuredCampaignQuery, /campaign.start_date_time/);
  assert.match(configuredCampaignQuery, /campaign.end_date_time/);
  assert.doesNotMatch(
    configuredCampaignQuery,
    /campaign\.(start_date|end_date)\b/,
  );
  const row = (id: string, startDateTime: string, endDateTime = "") => ({
    ...configured(id, "ENABLED"),
    campaign: { id, name: id, status: "ENABLED", startDateTime, endDateTime },
  });
  const activity = campaignActivity(
    [
      row("minute", "2026-10-15 23:59:00", "2026-10-16 00:00:00"),
      row("future", "2026-10-16 17:00:00"),
      row("ended", "2026-01-01 00:00:00", "2026-10-14 23:59:59"),
    ],
    [],
    "UTC",
    at,
  );
  assert.equal(activity.complete, true);
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-15", "2026-10-15")],
    ["minute"],
  );
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-16", "2026-10-16")],
    ["minute"],
  );
  const inZone = campaignActivity(
    [row("future", "2026-10-16 12:01:00")],
    [],
    "America/New_York",
    at,
  );
  assert.deepEqual(
    [...eligibleBudgetIds(inZone, "2026-10-16", "2026-10-16")],
    [],
  );
});
test("new date-time history paths reconstruct schedule changes and cleared end dates", () => {
  const change = event("1", "2026-10-16T10:00:00Z", "ENABLED", "ENABLED");
  Object.assign(change.changeEvent, {
    changedFields: "start_date_time,end_date_time",
    oldResource: {
      campaign: {
        startDateTime: "2026-10-15 00:00:00",
        endDateTime: "2026-10-15 23:59:59",
      },
    },
    newResource: { campaign: { startDateTime: "2026-10-15 00:00:00" } },
  });
  const current = configured("1", "ENABLED");
  Object.assign(current.campaign, {
    startDateTime: "2026-10-15 00:00:00",
    endDateTime: "",
  });
  const activity = campaignActivity([current], [change], "UTC", at);
  assert.equal(activity.complete, true);
  assert.equal(activity.events[0].before.endDate, "2026-10-15 23:59:59");
  assert.equal(activity.events[0].after.endDate, "");
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-15", "2026-10-15")],
    ["1"],
  );
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-16", "2026-10-16")],
    ["1"],
  );
});
test("date-time schedule bounds respect repeated DST hours and reject nonexistent local times", () => {
  const row = configured("1", "ENABLED");
  Object.assign(row.campaign, {
    startDateTime: "2026-11-01 01:15:00",
    endDateTime: "2026-11-01 01:45:00",
  });
  const activity = campaignActivity(
    [row],
    [event("1", "2026-11-01T06:20:00Z", "PAUSED", "ENABLED")],
    "America/New_York",
    "2026-11-02T15:00:00Z",
  );
  assert.equal(activity.complete, true);
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-11-01", "2026-11-01")],
    ["1"],
  );
  Object.assign(row.campaign, {
    startDateTime: "2026-03-08 02:30:00",
    endDateTime: "",
  });
  assert.equal(
    campaignActivity([row], [], "America/New_York", at).complete,
    false,
  );
});
test("paused all day is excluded; even one minute enabled with no delivery counts; shared budgets count once", () => {
  const activity = campaignActivity(
    [
      configured("1", "PAUSED"),
      configured("2", "PAUSED"),
      configured("3", "ENABLED", "shared"),
      configured("4", "PAUSED", "shared"),
    ],
    [
      event("2", "2026-10-15T10:00:00Z", "PAUSED", "ENABLED"),
      event("2", "2026-10-15T10:01:00Z", "ENABLED", "PAUSED"),
    ],
    "UTC",
    at,
  );
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-15", "2026-10-15")].sort(),
    ["2", "shared"],
  );
  const report = {
    date: "2026-10-15",
    timezone: "UTC",
    campaigns: [],
    budgets: activity.budgets,
  } as unknown as AdsReport;
  const result = activeBudget(report, activity);
  assert.equal(result.amount, 200);
  assert.equal(result.budgets.length, 2);
  assert.equal(
    activeBudget({ ...report, date: "2026-10-16" }, activity).amount,
    100,
  );
});
test("day boundaries use the Ads account timezone; midnight pause is excluded and midnight resume belongs to the new day", () => {
  const activity = campaignActivity(
    [configured("1", "PAUSED"), configured("2", "ENABLED")],
    [
      event("1", "2026-10-15T04:00:00Z", "ENABLED", "PAUSED"),
      event("2", "2026-10-16T04:00:00Z", "PAUSED", "ENABLED"),
    ],
    "America/New_York",
    at,
  );
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-15", "2026-10-15")],
    [],
  );
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-16", "2026-10-16")],
    ["2"],
  );
});
test("creation, scheduled start/end dates, and DST days cannot add inactive campaigns", () => {
  const activity = campaignActivity(
    [
      configured("1", "ENABLED"),
      configured("2", "ENABLED", "2", "2026-10-17"),
      configured("3", "ENABLED", "3", "2026-01-01", "2026-10-14"),
    ],
    [event("1", "2026-10-16T10:00:00Z", "", "ENABLED", "CREATE")],
    "UTC",
    at,
  );
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-15", "2026-10-15")],
    [],
  );
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-16", "2026-10-16")],
    ["1"],
  );
  const dst = campaignActivity(
    [configured("1", "PAUSED")],
    [
      event("1", "2026-11-01T05:30:00Z", "PAUSED", "ENABLED"),
      event("1", "2026-11-01T06:30:00Z", "ENABLED", "PAUSED"),
    ],
    "America/New_York",
    "2026-11-02T15:00:00Z",
  );
  assert.deepEqual(
    [...eligibleBudgetIds(dst, "2026-11-01", "2026-11-01")],
    ["1"],
  );
});
test("historical budget assignments follow their enabled intervals", () => {
  const change = event("1", "2026-10-16T10:00:00Z", "ENABLED", "ENABLED");
  Object.assign(change.changeEvent, {
    changedFields: "campaign_budget",
    oldResource: {
      campaign: { campaignBudget: "customers/1/campaignBudgets/11" },
    },
    newResource: {
      campaign: { campaignBudget: "customers/1/campaignBudgets/12" },
    },
  });
  const activity = campaignActivity(
    [configured("1", "ENABLED", "12")],
    [change],
    "UTC",
    at,
  );
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-15", "2026-10-15")],
    ["11"],
  );
  assert.deepEqual(
    [...eligibleBudgetIds(activity, "2026-10-16", "2026-10-16")].sort(),
    ["11", "12"],
  );
});
test("incomplete or unavailable history never turns unknown eligibility into zero; saved eligibility survives the lookup window", () => {
  const activity = campaignActivity(
    [configured("1", "PAUSED")],
    [],
    "UTC",
    at,
    "Quota paused",
  );
  const report = {
    date: "2026-10-15",
    timezone: "UTC",
    campaigns: [],
    budgets: activity.budgets,
  } as unknown as AdsReport;
  assert.equal(activeBudget(report, activity).amount, null);
  assert.equal(
    activeBudget(
      { ...report, date: "2026-01-01" },
      { ...activity, complete: true },
    ).amount,
    null,
  );
  const saved = {
    ...report,
    date: "2026-01-01",
    budgetEligibility: {
      from: "2026-01-01",
      to: "2026-01-01",
      complete: true,
      budgetIds: ["1"],
    },
  };
  assert.equal(activeBudget(saved, activity).amount, 100);
  assert.equal(
    activeBudget({
      ...report,
      budgetEligibility: {
        from: report.date,
        to: report.date,
        complete: true,
        budgetIds: [],
      },
    }).amount,
    0,
  );
});
