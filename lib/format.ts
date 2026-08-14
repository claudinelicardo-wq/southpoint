const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export function formatPeso(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return peso.format(Number.isFinite(n) ? n : 0);
}

const TZ = "Asia/Manila";

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TZ,
    dateStyle: "medium",
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TZ,
    timeStyle: "short",
  }).format(new Date(iso));
}

/** Asia/Manila calendar date for a timestamp, as YYYY-MM-DD — used to group
 * orders by business day regardless of the server/browser's own timezone. */
export function manilaDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}

/** Quantity: trim trailing zeros of numeric(14,4) strings. */
export function formatQty(q: number | string): string {
  const n = typeof q === "string" ? Number(q) : q;
  if (!Number.isFinite(n)) return "0";
  return n % 1 === 0 ? n.toLocaleString("en-PH") : n.toLocaleString("en-PH", { maximumFractionDigits: 4 });
}
