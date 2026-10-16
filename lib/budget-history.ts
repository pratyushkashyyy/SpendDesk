import type { Budget, BudgetHistory } from "./types";
export type BudgetStateRow = {
  store_id: string;
  budgets: Budget[];
  total: number | string | null;
  currency: string;
  timezone: string;
  changed_at: Date | string;
  confirmed_at: Date | string;
  history_checked_at: Date | string | null;
  history_error: string | null;
};
export type BudgetEventRow = {
  store_id: string;
  event_id: string;
  budget_id: string;
  previous_amount: number | string;
  amount: number | string;
  changed_at: Date | string;
  currency: string;
  timezone: string;
};
export type ObservedBudgetRow = {
  store_id: string;
  observed_at: Date | string;
  previous_at: Date | string;
  previous_total: number | string | null;
  total: number | string | null;
  currency: string;
  timezone: string;
};
const iso = (at: Date | string) => new Date(at).toISOString();
const amount = (value: number | string | null) =>
  value == null ? null : Number(value);
export function buildBudgetHistory(
  state: BudgetStateRow,
  events: BudgetEventRow[],
  observed: ObservedBudgetRow[],
): BudgetHistory {
  const actual = events
    .filter(
      (row) =>
        row.store_id === state.store_id && row.currency === state.currency,
    )
    .sort(
      (a, b) => Date.parse(iso(b.changed_at)) - Date.parse(iso(a.changed_at)),
    );
  const detected = observed
    .filter(
      (row) =>
        row.store_id === state.store_id && row.currency === state.currency,
    )
    .sort(
      (a, b) => Date.parse(iso(b.observed_at)) - Date.parse(iso(a.observed_at)),
    )[0];
  // A total from a saved configuration is trustworthy. A single Google budget
  // event cannot reconstruct the historical store total when other budgets may
  // have been added/removed in the meantime; retain exact events separately.
  return {
    budgets: state.budgets,
    current: amount(state.total),
    previous: detected ? amount(detected.previous_total) : null,
    changedAt: detected ? iso(detected.observed_at) : null,
    previousAt: detected ? iso(detected.previous_at) : null,
    source: detected ? "observed" : null,
    currency: state.currency,
    timezone: state.timezone,
    confirmedAt: iso(state.confirmed_at),
    checkedAt: state.history_checked_at ? iso(state.history_checked_at) : null,
    error: state.history_error,
    changes: [
      ...actual.map((row) => ({
        id: row.event_id,
        budgetId: row.budget_id,
        name:
          state.budgets.find((b) => b.id === row.budget_id)?.name ||
          `Budget ${row.budget_id}`,
        previous: Number(row.previous_amount),
        amount: Number(row.amount),
        changedAt: iso(row.changed_at),
        source: "google" as const,
      })),
      ...observed
        .filter(
          (row) =>
            row.store_id === state.store_id && row.currency === state.currency,
        )
        .map((row) => ({
          id: `observed-${iso(row.observed_at)}`,
          name: "Total daily budget",
          previous: amount(row.previous_total),
          amount: amount(row.total),
          changedAt: iso(row.observed_at),
          previousAt: iso(row.previous_at),
          source: "observed" as const,
        })),
    ]
      .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt))
      .slice(0, 30),
  };
}
