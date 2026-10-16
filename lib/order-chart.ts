import { dateInZone, validDate } from "./reporting";
import { reportDates } from "./report-ranges";
export type ChartPoint = {
  x: number;
  current: number | null;
  comparison: number | null;
  currentDate: string | null;
  comparisonDate: string | null;
  currentAt: string | null;
  comparisonAt: string | null;
};
export type OrderChartData = {
  mode: "daily" | "intraday";
  from: string;
  to: string;
  comparisonFrom: string;
  comparisonTo: string;
  timezone: string;
  points: ChartPoint[];
  total: number | null;
  comparisonTotal: number | null;
  percent: number | null;
  missingCurrent: number;
  missingComparison: number;
  errors: string[];
};
export function comparisonRange(
  from: string,
  to: string,
  mode: "period" | "month",
) {
  if (
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    Date.parse(to) - Date.parse(from) > 365 * 86400000
  )
    throw Error("Choose a valid range of up to 366 days.");
  const shift = (date: string, days: number) =>
    new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
  if (mode === "period") {
    const length = reportDates(from, to).length;
    return { from: shift(from, -length), to: shift(from, -1) };
  }
  const month = (date: string) => {
    const at = new Date(`${date}T12:00:00Z`),
      day = at.getUTCDate();
    at.setUTCDate(1);
    at.setUTCMonth(at.getUTCMonth() - 1);
    const last = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0),
    ).getUTCDate();
    at.setUTCDate(Math.min(day, last));
    return at.toISOString().slice(0, 10);
  };
  return { from: month(from), to: month(to) };
}
export type ChartRow = {
  report_date: string;
  payload: any;
  error?: string | null;
};
export function buildOrderChart(
  from: string,
  to: string,
  comparison: "period" | "month",
  zone: string,
  reports: ChartRow[],
  observations: ChartRow[],
  now = new Date(),
): OrderChartData {
  const previous = comparisonRange(from, to, comparison);
  const currentDays = reportDates(from, to),
    previousDays = reportDates(previous.from, previous.to);
  const valid = (row: ChartRow) =>
    row.payload?.timezone === zone &&
    Number.isFinite(row.payload.orders) &&
    row.payload.orders >= 0;
  const currentObservations = observations.filter(
    (row) =>
      row.report_date === from &&
      valid(row) &&
      Number.isFinite(Date.parse(row.payload.fetchedAt)) &&
      Date.parse(row.payload.fetchedAt) <= now.getTime() + 300000 &&
      dateInZone(zone, 0, new Date(row.payload.fetchedAt)) === row.report_date,
  );
  const intraday =
    from === to &&
    (from === dateInZone(zone, 0, now) || currentObservations.length > 0);
  const points: ChartPoint[] = [];
  let missingCurrent = 0,
    missingComparison = 0,
    total: number | null = null,
    comparisonTotal: number | null = null;
  if (intraday) {
    const minute = (at: string) => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(new Date(at));
      const get = (type: string) =>
        Number(parts.find((p) => p.type === type)?.value || 0);
      return get("hour") * 60 + get("minute") + get("second") / 60;
    };
    const unique = (rows: ChartRow[]) =>
      [
        ...new Map(rows.map((row) => [row.payload.fetchedAt, row])).values(),
      ].sort(
        (a, b) =>
          Date.parse(a.payload.fetchedAt) - Date.parse(b.payload.fetchedAt),
      );
    for (const row of unique(currentObservations))
      points.push({
        x: minute(row.payload.fetchedAt),
        current: row.payload.orders,
        comparison: null,
        currentDate: from,
        comparisonDate: null,
        currentAt: row.payload.fetchedAt,
        comparisonAt: null,
      });
    const past = unique(
      observations.filter(
        (row) =>
          row.report_date === previous.from &&
          valid(row) &&
          Number.isFinite(Date.parse(row.payload.fetchedAt)) &&
          dateInZone(zone, 0, new Date(row.payload.fetchedAt)) ===
            row.report_date,
      ),
    );
    for (const row of past) {
      const x = minute(row.payload.fetchedAt);
      const nearest = points
        .filter((p) => p.comparisonAt == null && Math.abs(p.x - x) <= 15)
        .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
      if (nearest)
        Object.assign(nearest, {
          comparison: row.payload.orders,
          comparisonDate: previous.from,
          comparisonAt: row.payload.fetchedAt,
        });
      else
        points.push({
          x,
          current: null,
          comparison: row.payload.orders,
          currentDate: null,
          comparisonDate: previous.from,
          currentAt: null,
          comparisonAt: row.payload.fetchedAt,
        });
    }
    points.sort((a, b) => a.x - b.x);
    const last = [...points]
      .filter((p) => p.currentAt)
      .sort((a, b) => Date.parse(b.currentAt!) - Date.parse(a.currentAt!))[0];
    total = last?.current ?? null;
    comparisonTotal = last?.comparison ?? null;
    missingCurrent = total == null ? 1 : 0;
    missingComparison = comparisonTotal == null ? 1 : 0;
  } else {
    let sum = 0,
      compSum = 0;
    for (
      let i = 0;
      i < Math.max(currentDays.length, previousDays.length);
      i++
    ) {
      const current = reports.find(
        (row) => row.report_date === currentDays[i] && valid(row),
      );
      const past = reports.find(
        (row) => row.report_date === previousDays[i] && valid(row),
      );
      if (i < currentDays.length) {
        if (current) sum += current.payload.orders;
        else missingCurrent++;
      }
      if (i < previousDays.length) {
        if (past) compSum += past.payload.orders;
        else missingComparison++;
      }
      points.push({
        x: i,
        current: current?.payload.orders ?? null,
        comparison: past?.payload.orders ?? null,
        currentDate: currentDays[i] || null,
        comparisonDate: previousDays[i] || null,
        currentAt: current?.payload.fetchedAt || null,
        comparisonAt: past?.payload.fetchedAt || null,
      });
    }
    total = missingCurrent ? null : sum;
    comparisonTotal = missingComparison ? null : compSum;
  }
  return {
    mode: intraday ? "intraday" : "daily",
    from,
    to,
    comparisonFrom: previous.from,
    comparisonTo: previous.to,
    timezone: zone,
    points,
    total,
    comparisonTotal,
    percent:
      total != null && comparisonTotal != null && comparisonTotal > 0
        ? ((total - comparisonTotal) / comparisonTotal) * 100
        : null,
    missingCurrent,
    missingComparison,
    errors: [
      ...new Set(
        reports
          .filter(
            (row) =>
              [...currentDays, ...previousDays].includes(row.report_date) &&
              row.error,
          )
          .map((row) => row.error!),
      ),
    ],
  };
}
