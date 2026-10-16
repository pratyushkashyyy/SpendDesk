import { db } from "./db";
import { combineDailyReports, type SavedReport } from "../report-ranges";

export async function savedReports(
  from: string,
  to: string,
  sql = db(),
): Promise<SavedReport[]> {
  const daily = await sql<
    SavedReport[]
  >`SELECT store_id,source,report_date::text,payload,error,checked_at FROM reports WHERE report_date BETWEEN ${from}::date AND ${to}::date ORDER BY report_date`;
  if (from === to) return daily;
  const exact = await sql<
    SavedReport[]
  >`SELECT store_id,source,(start_date::text || ' – ' || end_date::text) AS report_date,payload,error,checked_at FROM report_ranges WHERE start_date=${from}::date AND end_date=${to}::date`;
  const keys = new Set(
    [...daily, ...exact].map((r) => `${r.store_id}:${r.source}`),
  );
  return [...keys].flatMap((key) => {
    const matches = (r: SavedReport) => `${r.store_id}:${r.source}` === key;
    const stored = exact.find(matches);
    const days = daily.filter(matches);
    const combined = combineDailyReports(days, from, to);
    if (
      stored?.payload &&
      (!combined ||
        days.every(
          (r) => new Date(r.checked_at) <= new Date(stored.checked_at),
        ))
    )
      return [stored];
    return combined ? [combined] : stored ? [stored] : [];
  });
}
