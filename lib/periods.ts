// Manila business-period math for day / week / month views. Pure functions on
// YYYY-MM-DD keys; Manila is a fixed UTC+8 with no DST, so a day boundary is
// always `${date}T00:00:00+08:00`.

export type PeriodView = "day" | "week" | "month";

export const PERIOD_VIEWS: { key: PeriodView; label: string }[] = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYMD(value: unknown): value is string {
  return typeof value === "string" && YMD.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function toUTC(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function shiftDays(ymd: string, days: number): string {
  const d = toUTC(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

function shiftMonths(ymd: string, months: number): string {
  const d = toUTC(ymd);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromUTC(d);
}

/** First and (exclusive) last day of the period that contains `anchor`. Weeks start Monday. */
export function periodBounds(view: PeriodView, anchor: string): { start: string; end: string } {
  if (view === "day") return { start: anchor, end: shiftDays(anchor, 1) };
  if (view === "week") {
    const dow = (toUTC(anchor).getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const start = shiftDays(anchor, -dow);
    return { start, end: shiftDays(start, 7) };
  }
  const start = `${anchor.slice(0, 7)}-01`;
  return { start, end: shiftMonths(start, 1) };
}

/** Anchor of the previous/next period. */
export function stepPeriod(view: PeriodView, anchor: string, dir: -1 | 1): string {
  if (view === "day") return shiftDays(anchor, dir);
  if (view === "week") return shiftDays(periodBounds("week", anchor).start, 7 * dir);
  return shiftMonths(anchor, dir);
}

/** ISO instants bounding the period, for timestamptz range filters. */
export function periodInstants(view: PeriodView, anchor: string): { from: string; to: string } {
  const { start, end } = periodBounds(view, anchor);
  return {
    from: new Date(`${start}T00:00:00+08:00`).toISOString(),
    to: new Date(`${end}T00:00:00+08:00`).toISOString(),
  };
}

const longDate = new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", dateStyle: "medium" });
const monthYear = new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", month: "long", year: "numeric" });
const dayMonth = new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", month: "short", day: "numeric" });
const weekday = new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", weekday: "short" });

export function formatYMD(ymd: string): string {
  return longDate.format(toUTC(ymd));
}

export function formatYMDWithWeekday(ymd: string): string {
  return `${weekday.format(toUTC(ymd))}, ${longDate.format(toUTC(ymd))}`;
}

export function periodLabel(view: PeriodView, anchor: string): string {
  const { start, end } = periodBounds(view, anchor);
  if (view === "day") return formatYMDWithWeekday(start);
  if (view === "month") return monthYear.format(toUTC(start));
  const last = shiftDays(end, -1);
  return `${dayMonth.format(toUTC(start))} – ${longDate.format(toUTC(last))}`;
}
