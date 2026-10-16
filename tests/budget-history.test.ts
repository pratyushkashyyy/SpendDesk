import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBudgetEvents } from "../lib/server/budget-history";
import { buildBudgetHistory, type BudgetStateRow } from "../lib/budget-history";
const at = "2026-10-16T06:00:00.000Z";
const id = `customers/123/changeEvents/${BigInt(Date.parse(at)) * BigInt(1000)}~0~0`;
const event = {
  changeEvent: {
    resourceName: id,
    changeResourceName: "customers/123/campaignBudgets/55",
    changedFields: "amountMicros",
    resourceChangeOperation: "UPDATE",
    oldResource: { campaignBudget: { amountMicros: "50000000" } },
    newResource: { campaignBudget: { amountMicros: "75000000" } },
  },
};
test("Google budget edits preserve old/new amounts and exact timestamp; absent protobuf zero stays zero", () => {
  assert.deepEqual(parseBudgetEvents([event]), [
    { id, budgetId: "55", previous: 50, amount: 75, changedAt: at },
  ]);
  assert.equal(
    parseBudgetEvents([
      {
        changeEvent: {
          ...event.changeEvent,
          oldResource: { campaignBudget: {} },
        },
      },
    ])[0].previous,
    0,
  );
  assert.equal(
    parseBudgetEvents([
      { changeEvent: { ...event.changeEvent, changedFields: "name" } },
    ]).length,
    0,
  );
  assert.equal(
    parseBudgetEvents([
      { changeEvent: { ...event.changeEvent, resourceName: "invalid" } },
    ]).length,
    0,
  );
  assert.equal(
    parseBudgetEvents([
      {
        changeEvent: {
          ...event.changeEvent,
          newResource: { campaignBudget: { amountMicros: "50000000" } },
        },
      },
    ]).length,
    0,
  );
});
test("exact individual budget edits never invent a historical total for the store", () => {
  const state: BudgetStateRow = {
    store_id: "s",
    budgets: [
      {
        id: "55",
        name: "Shopping",
        amount: 75,
        period: "DAILY",
        campaigns: ["Shopping"],
        shared: false,
      },
    ],
    total: "75",
    currency: "USD",
    timezone: "Asia/Kolkata",
    changed_at: at,
    confirmed_at: at,
    history_checked_at: at,
    history_error: null,
  };
  const result = buildBudgetHistory(
    state,
    [
      {
        store_id: "s",
        event_id: id,
        budget_id: "55",
        previous_amount: "50",
        amount: "75",
        changed_at: at,
        currency: "USD",
        timezone: "Asia/Kolkata",
      },
    ],
    [],
  );
  assert.equal(result.current, 75);
  assert.equal(result.previous, null);
  assert.equal(result.source, null);
  assert.equal(result.changes[0].previous, 50);
  assert.equal(result.changes[0].source, "google");
  const observed = buildBudgetHistory(
    state,
    [],
    [
      {
        store_id: "s",
        observed_at: at,
        previous_at: "2026-10-16T05:00:00Z",
        previous_total: "40",
        total: "75",
        currency: "USD",
        timezone: "Asia/Kolkata",
      },
    ],
  );
  assert.equal(observed.previous, 40);
  assert.equal(observed.source, "observed");
  assert.equal(observed.previousAt, "2026-10-16T05:00:00.000Z");
});
