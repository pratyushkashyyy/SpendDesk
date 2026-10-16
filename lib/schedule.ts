import { dateInZone } from "./reporting";

// Automatic reports refresh once an hour, regardless of store count.
export function refreshIntervalMinutes() {
  return 60;
}

// Match the dashboard's Last 30 days preset, including today in India.
export function last30ReportRange(now = new Date()) {
  return {
    from: dateInZone("Asia/Kolkata", -29, now),
    to: dateInZone("Asia/Kolkata", 0, now),
  };
}
