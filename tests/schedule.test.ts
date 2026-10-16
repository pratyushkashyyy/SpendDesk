import { test } from "node:test";
import assert from "node:assert/strict";
import { last30ReportRange } from "../lib/schedule";
import { reportDates } from "../lib/report-ranges";

test("9 AM daily refresh covers the same 30 dates as the dashboard, including today", () => {
  const range = last30ReportRange(new Date("2026-10-16T03:30:00Z"));
  assert.deepEqual(range, { from: "2026-09-17", to: "2026-10-16" });
  assert.equal(reportDates(range.from, range.to).length, 30);
});

test("daily ranges follow India's date across UTC midnight, leap days and year boundaries", () => {
  assert.deepEqual(last30ReportRange(new Date("2025-12-31T18:30:00Z")), {
    from: "2025-12-03",
    to: "2026-01-01",
  });
  assert.deepEqual(last30ReportRange(new Date("2028-03-01T03:30:00Z")), {
    from: "2028-02-01",
    to: "2028-03-01",
  });
});
