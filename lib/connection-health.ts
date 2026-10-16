import type { ConnectionHealth } from "./types";
export const uncheckedHealth: ConnectionHealth = {
  status: "unchecked",
  message: "Credentials saved. Refresh data to verify access.",
  checkedAt: null,
};
export function healthLabel(health?: ConnectionHealth) {
  switch (health?.status) {
    case "healthy":
      return "Access verified";
    case "reauthorization_required":
      return "Reauthorization required";
    case "rate_limited":
      return "Report quota limited";
    case "attention":
      return "Needs attention";
    case "not_connected":
      return "Setup needed";
    default:
      return "Not checked yet";
  }
}
export function resolvedHealth(
  stored: ConnectionHealth | undefined,
  report:
    | { error: string | null; checked_at: Date | string; available?: boolean }
    | undefined,
  connected = true,
): ConnectionHealth {
  if (!connected)
    return {
      status: "not_connected",
      message: "Add Shopify credentials to connect this store.",
      checkedAt: null,
    };
  if (stored?.status === "reauthorization_required") return stored;
  if (report && !report.error && report.available === false)
    return stored || uncheckedHealth;
  if (
    report?.error &&
    (/\(429\)/.test(report.error) ||
      /^Google API.*(quota|budget|cooling down)/.test(report.error)) &&
    (stored?.status === "healthy" ||
      !stored?.checkedAt ||
      new Date(report.checked_at).getTime() > Date.parse(stored.checkedAt))
  )
    return {
      status: "rate_limited",
      message: `${stored?.status === "healthy" ? "Authorization verified. " : ""}${report.error} Reconnecting will not fix this.`,
      checkedAt: new Date(report.checked_at).toISOString(),
    };
  if (stored?.status === "healthy" && report?.error)
    return {
      status: "attention",
      message: `Authorization verified. The latest report still needs attention: ${report.error}`,
      checkedAt: new Date(report.checked_at).toISOString(),
    };
  if (
    report &&
    (!stored?.checkedAt ||
      new Date(report.checked_at).getTime() > Date.parse(stored.checkedAt))
  )
    return {
      status: report.error ? "attention" : "healthy",
      message:
        report.error || "Access verified during the latest report refresh.",
      checkedAt: new Date(report.checked_at).toISOString(),
    };
  return stored || uncheckedHealth;
}
