import { dateInZone, validDate } from "./reporting";
import type { Period } from "./types";

export type ReportSelection = { period: Period; from: string; to: string };

// Presets stay relative to India's current day. Custom ranges retain exact dates.
export function resolveReportSelection(
  params: Record<string, string | string[] | undefined>,
  now = new Date(),
): ReportSelection {
  const day = (offset = 0) => dateInZone("Asia/Kolkata", offset, now);
  const { period, from, to } = params;
  if (period === "today") return { period, from: day(), to: day() };
  if (period === "last7") return { period, from: day(-6), to: day() };
  if (period === "last30") return { period, from: day(-29), to: day() };
  if (period === "monthToDate")
    return { period, from: `${day().slice(0, 8)}01`, to: day() };
  if (
    (period === "custom" || period === undefined) &&
    typeof from === "string" &&
    typeof to === "string" &&
    validDate(from) &&
    validDate(to) &&
    from <= to &&
    Date.parse(to) - Date.parse(from) <= 365 * 86400000
  )
    return { period: "custom", from, to };
  return { period: "yesterday", from: day(-1), to: day(-1) };
}
