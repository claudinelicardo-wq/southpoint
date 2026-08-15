// Shared pre-order types and slot math, used by the public page, the submit
// API, and the staff review page. Pure functions only — callers pass the
// clock so nothing here reads Date.now() during a React render.

export interface PreorderSettings {
  enabled: boolean;
  open_time: string; // "HH:MM"
  close_time: string; // "HH:MM"
  slot_capacity: number;
  lead_minutes: number;
}

export const PREORDER_DEFAULTS: PreorderSettings = {
  enabled: false,
  open_time: "10:00",
  close_time: "21:00",
  slot_capacity: 4,
  lead_minutes: 45,
};

export function parsePreorderSettings(value: unknown): PreorderSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  const time = (x: unknown, fallback: string) =>
    typeof x === "string" && /^\d{2}:\d{2}$/.test(x) ? x : fallback;
  return {
    enabled: Boolean(v.enabled ?? PREORDER_DEFAULTS.enabled),
    open_time: time(v.open_time, PREORDER_DEFAULTS.open_time),
    close_time: time(v.close_time, PREORDER_DEFAULTS.close_time),
    slot_capacity: Math.max(1, Number(v.slot_capacity) || PREORDER_DEFAULTS.slot_capacity),
    lead_minutes: Math.max(0, Number(v.lead_minutes) || PREORDER_DEFAULTS.lead_minutes),
  };
}

const TZ = "Asia/Manila";

/** Manila "now" split into date key and minutes-since-midnight. */
export function manilaNow(now: Date): { date: string; minutes: number } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  const [h, m] = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(now)
    .split(":")
    .map(Number);
  return { date, minutes: h * 60 + m };
}

export function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function slotLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const end = h * 60 + m + 30;
  const fmt = (mins: number) => {
    const hh = Math.floor(mins / 60) % 24;
    const ampm = hh < 12 ? "AM" : "PM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${String(mins % 60).padStart(2, "0")} ${ampm}`;
  };
  return `${fmt(h * 60 + m)} – ${fmt(end)}`;
}

/**
 * All 30-minute slot starts ("HH:MM") for a pickup date, honoring opening
 * hours and — for today — the lead time. Capacity filtering happens in the
 * caller, which knows the current booking counts.
 */
export function slotsForDate(
  settings: PreorderSettings,
  pickupDate: string,
  now: Date,
): string[] {
  const { date: today, minutes: nowMinutes } = manilaNow(now);
  const open = toMinutes(settings.open_time);
  const close = toMinutes(settings.close_time);
  const earliest =
    pickupDate === today ? Math.max(open, nowMinutes + settings.lead_minutes) : open;
  const slots: string[] = [];
  for (let t = open; t + 30 <= close; t += 30) {
    if (t < earliest) continue;
    slots.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return slots;
}

export interface PreorderItemSnapshot {
  product_id: string;
  name: string;
  variant_id: string | null;
  variant_name: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
}

export const PREORDER_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  ready: "Ready",
  picked_up: "Picked up",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
