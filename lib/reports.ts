// Reporting helpers shared by the Reports and Accounting pages.
//
// Date ranges are resolved to Asia/Manila calendar boundaries and returned as
// ISO timestamptz strings [from, to) that the SQL report functions accept.
// These run only in server components / event handlers (never inside a React
// render), so reading the clock here is fine.

export type RangeKey =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "prev_month"
  | "custom";

/** Breakdown dimensions offered on the Reports page. */
export const DIMENSIONS: { key: string; label: string }[] = [
  { key: "product", label: "By product" },
  { key: "category", label: "By category" },
  { key: "day", label: "By day" },
  { key: "hour", label: "By hour" },
  { key: "cashier", label: "By cashier" },
  { key: "order_type", label: "By order type" },
  { key: "payment_method", label: "By payment method" },
];

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "prev_month", label: "Previous month" },
  { key: "custom", label: "Custom range" },
];

export interface ResolvedRange {
  key: RangeKey;
  from: string; // ISO timestamptz, inclusive
  to: string; // ISO timestamptz, exclusive
  fromDate: string; // YYYY-MM-DD (for <input type=date> defaults)
  toDate: string; // YYYY-MM-DD, inclusive day shown to the user
  label: string;
}

const TZ = "Asia/Manila";
const OFFSET = "+08:00"; // Philippines has no DST

/** Today's Manila calendar date, shifted by `offsetDays`, as YYYY-MM-DD. */
function manilaYMD(offsetDays = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return shifted.toISOString().slice(0, 10);
}

/** Add whole days to a YYYY-MM-DD string (calendar arithmetic, TZ-agnostic). */
function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function startOfIso(ymd: string): string {
  return `${ymd}T00:00:00.000${OFFSET}`;
}

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Resolve a preset (or custom from/to) into ISO range bounds. */
export function resolveRange(
  key: RangeKey,
  fromParam?: string,
  toParam?: string,
): ResolvedRange {
  const todayYMD = manilaYMD(0);
  let fromDay: string;
  let toDayInclusive: string;

  switch (key) {
    case "yesterday": {
      fromDay = manilaYMD(-1);
      toDayInclusive = fromDay;
      break;
    }
    case "week": {
      // Since Monday of the current Manila week.
      const [y, m, d] = todayYMD.split("-").map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
      const backToMon = (dow + 6) % 7;
      fromDay = addDays(todayYMD, -backToMon);
      toDayInclusive = todayYMD;
      break;
    }
    case "month": {
      fromDay = `${todayYMD.slice(0, 7)}-01`;
      toDayInclusive = todayYMD;
      break;
    }
    case "prev_month": {
      const [y, m] = todayYMD.split("-").map(Number);
      const firstThis = new Date(Date.UTC(y, m - 1, 1));
      const firstPrev = new Date(Date.UTC(y, m - 2, 1));
      fromDay = firstPrev.toISOString().slice(0, 10);
      toDayInclusive = addDays(firstThis.toISOString().slice(0, 10), -1);
      break;
    }
    case "custom": {
      fromDay = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : todayYMD;
      toDayInclusive =
        toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : fromDay;
      if (toDayInclusive < fromDay) toDayInclusive = fromDay;
      break;
    }
    case "today":
    default: {
      fromDay = todayYMD;
      toDayInclusive = todayYMD;
      break;
    }
  }

  const toExclusive = addDays(toDayInclusive, 1);
  const label =
    fromDay === toDayInclusive
      ? prettyDate(fromDay)
      : `${prettyDate(fromDay)} – ${prettyDate(toDayInclusive)}`;

  return {
    key,
    from: startOfIso(fromDay),
    to: startOfIso(toExclusive),
    fromDate: fromDay,
    toDate: toDayInclusive,
    label,
  };
}

/** Escape and join rows into a CSV string (RFC-4180-ish). */
export function toCSV(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}
