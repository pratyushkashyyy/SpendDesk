"use client";
import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateInZone } from "@/lib/reporting";
import type { Period } from "@/lib/types";
import type { DateRange } from "react-day-picker";
const atNoon = (value: string) => new Date(`${value}T12:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (days: number) => dateInZone("Asia/Kolkata", days);
const openingMonth = (range: DateRange) => {
  const end = range.to || range.from || atNoon(shift(0));
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
};
const labels: Record<Period, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  monthToDate: "Month to date",
  custom: "Custom range",
};
function preset(value: Period): DateRange {
  const today = shift(0),
    yesterday = shift(-1);
  if (value === "today") return { from: atNoon(today), to: atNoon(today) };
  if (value === "yesterday")
    return { from: atNoon(yesterday), to: atNoon(yesterday) };
  if (value === "last7") return { from: atNoon(shift(-6)), to: atNoon(today) };
  if (value === "last30")
    return { from: atNoon(shift(-29)), to: atNoon(today) };
  if (value === "monthToDate")
    return { from: atNoon(`${today.slice(0, 8)}01`), to: atNoon(today) };
  return { from: undefined, to: undefined };
}
function pretty(from: string, to: string) {
  const format = (v: string) =>
    atNoon(v).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}
export default function DateRangeFilter({
  period,
  from,
  to,
  onApply,
}: {
  period: Period;
  from: string;
  to: string;
  onApply: (period: Period, from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [choice, setChoice] = useState(period),
    [draft, setDraft] = useState<DateRange>({
      from: atNoon(from),
      to: atNoon(to),
    });
  function choose(value: Period) {
    setChoice(value);
    if (value !== "custom") setDraft(preset(value));
  }
  function apply() {
    if (!draft.from) return;
    const start = iso(draft.from),
      end = iso(draft.to || draft.from);
    onApply(choice, start, end);
    setOpen(false);
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setChoice(period);
          setDraft({ from: atNoon(from), to: atNoon(to) });
        }
      }}
    >
      <PopoverTrigger
        className="shopify-date-trigger"
        aria-label="Choose report date range"
      >
        <CalendarDays size={15} />
        <span>
          <strong>{labels[period]}</strong>
          <small>{pretty(from, to)}</small>
        </span>
        <ChevronDown size={14} />
      </PopoverTrigger>
      <PopoverContent className="shopify-date-popover" align="end">
        <div className="date-preset-list">
          <strong>Date range</strong>
          {(
            [
              "today",
              "yesterday",
              "last7",
              "last30",
              "monthToDate",
              "custom",
            ] as Period[]
          ).map((value) => (
            <button
              key={value}
              data-active={choice === value}
              onClick={() => choose(value)}
            >
              {labels[value]}
            </button>
          ))}
        </div>
        <div className="date-calendar-panel">
          <div className="date-fields">
            <label>
              Start date
              <input
                type="date"
                value={draft.from ? iso(draft.from) : ""}
                max={shift(0)}
                onChange={(e) => {
                  if (e.target.value) {
                    setChoice("custom");
                    setDraft((old) => ({
                      from: atNoon(e.target.value),
                      to:
                        old.to && old.to >= atNoon(e.target.value)
                          ? old.to
                          : atNoon(e.target.value),
                    }));
                  }
                }}
              />
            </label>
            <span>→</span>
            <label>
              End date
              <input
                type="date"
                value={draft.to ? iso(draft.to) : ""}
                min={draft.from ? iso(draft.from) : undefined}
                max={shift(0)}
                onChange={(e) => {
                  if (e.target.value) {
                    setChoice("custom");
                    setDraft((old) => ({
                      from: old.from || atNoon(e.target.value),
                      to: atNoon(e.target.value),
                    }));
                  }
                }}
              />
            </label>
          </div>
          <Calendar
            mode="range"
            selected={draft}
            onSelect={(range) => {
              setChoice("custom");
              setDraft(range || { from: undefined, to: undefined });
            }}
            numberOfMonths={2}
            disabled={{ after: atNoon(shift(0)) }}
            defaultMonth={openingMonth(draft)}
          />
          <div className="date-actions">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!draft.from} onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
