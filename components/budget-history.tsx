"use client";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Store, BudgetHistory as HistoryData } from "@/lib/types";
import { formatMoney } from "@/lib/reporting";
export function CurrentBudget({ store }: { store: Store }) {
  if (store.activeBudget !== undefined) {
    const active = store.activeBudget;
    return (
      <span title={active?.note}>
        <span className="numeric">
          {formatMoney(active?.amount, store.ads?.currency)}
        </span>
        <small className="cell-sub">
          {!active?.complete
            ? "Campaign history pending"
            : `${active.budgets.length} budget${active.budgets.length === 1 ? "" : "s"} · ran in period`}
        </small>
      </span>
    );
  }
  const budgets = store.budgetHistory?.budgets || store.ads?.budgets;
  const currency = store.budgetHistory?.currency || store.ads?.currency;
  if (!budgets?.length) return <>—</>;
  const total = store.budgetHistory
    ? store.budgetHistory.current
    : budgets.every((b) => b.amount != null)
      ? budgets.reduce((sum, b) => sum + (b.amount || 0), 0)
      : null;
  return (
    <>
      <span className="numeric">{formatMoney(total, currency)}</span>
      <small className="cell-sub">
        {budgets.length} budget{budgets.length === 1 ? "" : "s"}
        {budgets.some((b) => b.shared)
          ? " · shared budgets counted once · per day"
          : budgets.some((b) => b.amount == null)
            ? " · includes non-daily budgets"
            : " · per day"}
      </small>
    </>
  );
}
export default function BudgetHistory({ store }: { store: Store }) {
  const [open, setOpen] = useState(false);
  const [refreshed, setRefreshed] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(false),
    [message, setMessage] = useState("");
  const saved = store.budgetHistory;
  useEffect(() => setMessage(""), [saved?.checkedAt]);
  const history =
    refreshed &&
    (!saved?.checkedAt ||
      (refreshed.checkedAt &&
        Date.parse(refreshed.checkedAt) > Date.parse(saved.checkedAt)))
      ? refreshed
      : saved;
  async function refresh() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/budget-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: store.id }),
      });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      const body = await res.json();
      if (!res.ok)
        throw Error(body.error || "Budget history could not be refreshed.");
      if (body.history) {
        setRefreshed(body.history);
        setMessage(body.history.error || "");
      } else setMessage(body.message || "");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const zone = history?.timezone || store.ads?.timezone || "Asia/Kolkata";
  const stamp = (at: string) =>
    new Date(at).toLocaleString("en-IN", {
      timeZone: zone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const latest = history?.changes.find((change) => change.source === "google");
  const lastChange = history?.changes[0];
  const changeDate = lastChange
    ? new Date(lastChange.changedAt).toLocaleDateString("en-IN", {
        timeZone: zone,
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;
  return (
    <div
      className="budget-history"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="budget-history-trigger"
        aria-label={`Budget history for ${store.name}`}
        aria-haspopup="dialog"
        title={
          lastChange
            ? `${lastChange.name}: ${formatMoney(lastChange.previous, history?.currency)} → ${formatMoney(lastChange.amount, history?.currency)} · ${lastChange.source === "google" ? "Changed" : "Change detected"} ${stamp(lastChange.changedAt)} (${zone})${lastChange.previousAt ? ` · Previously confirmed ${stamp(lastChange.previousAt)}` : ""}`
            : "No previous budget change recorded yet · View budget history"
        }
        onClick={() => setOpen(true)}
      >
        {lastChange
          ? `${lastChange.source === "google" ? "Changed" : "Detected"} ${changeDate} · Was ${formatMoney(lastChange.previous, history?.currency)}`
          : "No previous change recorded"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="budget-history-dialog"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{store.name} · Budget history</DialogTitle>
            <DialogDescription>
              Current budget settings and previous changes · {zone}
            </DialogDescription>
          </DialogHeader>
          <div className="budget-history-actions">
            <button
              type="button"
              disabled={loading || !history}
              onClick={refresh}
            >
              {loading ? "Refreshing…" : "Refresh Google history"}
            </button>
          </div>
          {message && (
            <p className="budget-history-note" role="status">
              {message}
            </p>
          )}
          <div className="budget-history-totals">
            <div>
              <span>All configured daily budgets</span>
              <strong>
                {formatMoney(
                  history?.current,
                  history?.currency || store.ads?.currency,
                )}
              </strong>
              <small>
                {history?.confirmedAt
                  ? `Saved ${stamp(history.confirmedAt)}`
                  : "Not recorded yet"}
              </small>
            </div>
            <div>
              <span>Previously saved total</span>
              <strong>
                {formatMoney(
                  history?.previous,
                  history?.currency || store.ads?.currency,
                )}
              </strong>
              <small>
                {history?.previousAt
                  ? `Last confirmed ${stamp(history.previousAt)}`
                  : "No earlier configuration recorded"}
              </small>
            </div>
          </div>
          {latest &&
            history?.confirmedAt &&
            Date.parse(latest.changedAt) > Date.parse(history.confirmedAt) && (
              <p className="budget-history-note">
                Google has a newer edit than the saved budget total. Refresh the
                store reports to update that total.
              </p>
            )}
          {history?.previousAt && history.changedAt && (
            <p className="budget-history-note">
              The saved configuration changed between{" "}
              {stamp(history.previousAt)} and {stamp(history.changedAt)}. Google
              edit times, when available, are shown below.
            </p>
          )}
          {history?.error && (
            <p className="budget-history-note">
              Google history refresh: {history.error} Saved changes remain
              available.
            </p>
          )}
          {!history?.checkedAt && !history?.error && (
            <p className="budget-history-note">
              Recent Google edit history is being prepared using the available
              background quota. This panel updates with the dashboard.
            </p>
          )}
          {history?.changes.length ? (
            <div className="budget-history-list">
              {history.changes.map((change) => (
                <div key={change.id}>
                  <div>
                    <strong>{change.name}</strong>
                    <span>
                      {change.source === "google"
                        ? "Google Ads edit"
                        : "Saved configuration"}
                    </span>
                  </div>
                  <p>
                    {formatMoney(change.previous, history.currency)}{" "}
                    <span>→</span>{" "}
                    {formatMoney(change.amount, history.currency)}
                  </p>
                  <small>
                    {change.source === "google"
                      ? `Changed ${stamp(change.changedAt)}`
                      : `Detected ${stamp(change.changedAt)}${change.previousAt ? ` · Previously confirmed ${stamp(change.previousAt)}` : ""}`}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="budget-history-note">
              No previous change is recorded yet. New budget configurations are
              retained as reports sync.
            </p>
          )}
          <p className="budget-history-note">
            Google provides recent edit history for up to 30 days. Saved
            configurations and imported edits are retained here. Shared budgets
            count once in the total; non-daily or unavailable amounts are not
            combined. This history includes paused campaigns; the store table
            only counts budgets for campaigns that ran during its selected
            dates.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
