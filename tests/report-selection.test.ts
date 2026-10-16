import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReportSelection } from "../lib/report-selection";
const now = new Date("2026-10-16T07:00:00Z");

test("saved presets restore their current date range instead of falling back to Yesterday", () => {
  for (const [period, from, to] of [
    ["today", "2026-10-16", "2026-10-16"],
    ["yesterday", "2026-10-15", "2026-10-15"],
    ["last7", "2026-10-10", "2026-10-16"],
    ["last30", "2026-09-17", "2026-10-16"],
    ["monthToDate", "2026-10-01", "2026-10-16"],
  ])
    assert.deepEqual(resolveReportSelection({ period }, now), {
      period,
      from,
      to,
    });
});

test("Today follows India's new day on reload while custom dates remain fixed", () => {
  const midnight = new Date("2026-10-16T18:30:00Z");
  assert.deepEqual(
    resolveReportSelection(
      { period: "today", from: "2026-10-16", to: "2026-10-16" },
      midnight,
    ),
    { period: "today", from: "2026-10-17", to: "2026-10-17" },
  );
  const custom = { period: "custom", from: "2026-09-20", to: "2026-10-05" };
  assert.deepEqual(resolveReportSelection(custom, midnight), custom);
  assert.deepEqual(
    resolveReportSelection({ from: custom.from, to: custom.to }, midnight),
    custom,
  );
});

test("malformed or oversized query ranges safely use the default", () => {
  const fallback = {
    period: "yesterday",
    from: "2026-10-15",
    to: "2026-10-15",
  };
  for (const params of [
    {},
    { period: "bogus" },
    { period: ["today", "yesterday"] },
    { period: "custom", from: "2026-02-30", to: "2026-03-01" },
    { period: "custom", from: "2026-10-16", to: "2026-10-15" },
    { period: "custom", from: "2024-01-01", to: "2026-10-16" },
    { period: "custom", from: ["2026-10-15"], to: "2026-10-16" },
  ])
    assert.deepEqual(resolveReportSelection(params, now), fallback);
});
