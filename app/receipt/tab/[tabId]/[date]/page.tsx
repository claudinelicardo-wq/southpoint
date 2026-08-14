import { formatPeso, formatQty, formatTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import type { OrderType } from "../../../../(app)/orders/orders-manager";
import { DayReceiptActions } from "./day-receipt-actions";

export const metadata = { title: "Tab receipt" };

const TYPE_LABELS: Record<OrderType, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  courtside: "Courtside",
  tab: "Tab",
};

const DISCOUNT_LABELS: Record<string, string> = {
  percent: "Discount",
  fixed: "Discount",
  senior: "Senior Citizen",
  pwd: "PWD",
  loyalty: "Loyalty",
  promo: "Promo",
  comp: "Complimentary",
  manual: "Discount",
};

interface DayOrder {
  id: string;
  order_number: string;
  order_type: OrderType;
  courtside_label: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  service_charge: number;
  total: number;
  created_at: string;
  completed_at: string | null;
  profiles: { full_name: string } | null;
  order_items: {
    id: string;
    product_name: string;
    variant_name: string | null;
    qty: number;
    line_total: number;
    order_item_modifiers: { id: string; option_name: string; price_delta: number }[];
  }[];
  order_discounts: { id: string; discount_type: string; amount: number; reason: string | null }[];
  payments: {
    id: string;
    amount: number;
    reference_no: string | null;
    created_at: string;
    payment_methods: { name: string } | null;
  }[];
}

interface BusinessProfile {
  name?: string;
  tagline?: string;
  address?: string;
  phone?: string;
}

interface ReceiptSettings {
  width_mm?: number;
  footer?: string;
}

// Fixed +08:00 offset: the Philippines has no DST, matching lib/reports.ts.
function manilaDayRange(date: string): { from: string; to: string } {
  const [y, m, d] = date.split("-").map(Number);
  const from = `${date}T00:00:00.000+08:00`;
  const to = `${new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)}T00:00:00.000+08:00`;
  return { from, to };
}

export default async function TabDayReceiptPage({
  params,
}: {
  params: Promise<{ tabId: string; date: string }>;
}) {
  const { tabId, date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "orders.view")) {
    redirect("/dashboard");
  }
  if (session.preview) notFound();

  const supabase = await createClient();
  const { from, to } = manilaDayRange(date);
  const [t, o, s] = await Promise.all([
    supabase.from("tabs").select("id, name").eq("id", tabId).maybeSingle<{
      id: string;
      name: string;
    }>(),
    supabase
      .from("orders")
      .select(
        `id, order_number, order_type, courtside_label, subtotal, discount_total, tax_total,
         service_charge, total, created_at, completed_at, profiles(full_name),
         order_items(*, order_item_modifiers(*)), order_discounts(*),
         payments(*, payment_methods(name))`,
      )
      .eq("tab_id", tabId)
      .eq("status", "completed")
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true }),
    supabase
      .from("settings")
      .select("key, value")
      .in("key", ["business_profile", "receipt"]),
  ]);
  const tab = t.data;
  if (!tab) notFound();
  const orders = (o.data as unknown as DayOrder[] | null) ?? [];
  if (orders.length === 0) notFound();

  const settings = new Map(
    ((s.data as { key: string; value: Record<string, unknown> }[] | null) ?? []).map((row) => [
      row.key,
      row.value,
    ]),
  );
  const business = (settings.get("business_profile") ?? {}) as BusinessProfile;
  const receipt = (settings.get("receipt") ?? {}) as ReceiptSettings;
  const widthMm = Number(receipt.width_mm) || 58;

  const subtotal = orders.reduce((sum, ord) => sum + Number(ord.subtotal), 0);
  const discountTotal = orders.reduce((sum, ord) => sum + Number(ord.discount_total), 0);
  const taxTotal = orders.reduce((sum, ord) => sum + Number(ord.tax_total), 0);
  const serviceCharge = orders.reduce((sum, ord) => sum + Number(ord.service_charge), 0);
  const grandTotal = orders.reduce((sum, ord) => sum + Number(ord.total), 0);
  const allPayments = orders.flatMap((ord) => ord.payments);
  const paidTotal = allPayments.reduce((sum, p) => sum + Number(p.amount), 0);

  const dateLabel = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
  }).format(new Date(`${date}T12:00:00`));

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-4 py-8">
      <DayReceiptActions />

      <div
        className="print-receipt w-full max-w-80 rounded-lg border border-line bg-white p-4 font-mono text-xs text-espresso shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
        style={{ "--receipt-width": `${widthMm}mm` } as React.CSSProperties}
      >
        {/* Header */}
        <div className="text-center">
          <p className="text-sm font-bold">{business.name ?? "South Point"}</p>
          {business.tagline && <p className="mt-0.5">{business.tagline}</p>}
          {business.address && <p className="mt-0.5">{business.address}</p>}
          {business.phone && <p className="mt-0.5">{business.phone}</p>}
        </div>

        <hr className="my-2 border-dashed border-line" />

        <div className="space-y-0.5">
          <div className="flex justify-between gap-2">
            <span>Tab: {tab.name}</span>
            <span>{dateLabel}</span>
          </div>
          <p>
            {orders.length} order{orders.length === 1 ? "" : "s"} this day
          </p>
        </div>

        {/* One section per order, all on the same combined receipt */}
        {orders.map((ord) => (
          <div key={ord.id}>
            <hr className="my-2 border-dashed border-line" />
            <div className="flex justify-between gap-2 font-bold">
              <span>{ord.order_number}</span>
              <span>{TYPE_LABELS[ord.order_type]}</span>
            </div>
            <p>{formatTime(ord.created_at)}</p>
            <div className="mt-1 space-y-1">
              {ord.order_items.map((item) => (
                <div key={item.id}>
                  <div className="flex justify-between gap-2">
                    <span>
                      {formatQty(item.qty)} x {item.product_name}
                      {item.variant_name && ` (${item.variant_name})`}
                    </span>
                    <span className="shrink-0 text-right">{formatPeso(item.line_total)}</span>
                  </div>
                  {item.order_item_modifiers.map((mod) => (
                    <p key={mod.id} className="pl-4">
                      + {mod.option_name}
                      {Number(mod.price_delta) !== 0 && ` +${formatPeso(mod.price_delta)}`}
                    </p>
                  ))}
                </div>
              ))}
              {ord.order_discounts.map((disc) => (
                <div key={disc.id} className="flex justify-between gap-2">
                  <span>
                    {DISCOUNT_LABELS[disc.discount_type] ?? disc.discount_type}
                    {disc.reason && ` (${disc.reason})`}
                  </span>
                  <span>−{formatPeso(disc.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between gap-2 font-semibold">
                <span>Order total</span>
                <span>{formatPeso(ord.total)}</span>
              </div>
            </div>
          </div>
        ))}

        <hr className="my-2 border-dashed border-line" />

        {/* Combined totals across the whole day */}
        <div className="space-y-0.5">
          <div className="flex justify-between gap-2">
            <span>Subtotal</span>
            <span>{formatPeso(subtotal)}</span>
          </div>
          {discountTotal > 0 && (
            <div className="flex justify-between gap-2">
              <span>Discounts</span>
              <span>−{formatPeso(discountTotal)}</span>
            </div>
          )}
          {taxTotal > 0 && (
            <div className="flex justify-between gap-2">
              <span>VAT</span>
              <span>{formatPeso(taxTotal)}</span>
            </div>
          )}
          {serviceCharge > 0 && (
            <div className="flex justify-between gap-2">
              <span>Service charge</span>
              <span>{formatPeso(serviceCharge)}</span>
            </div>
          )}
          <div className="flex justify-between gap-2 text-sm font-bold">
            <span>DAY TOTAL</span>
            <span>{formatPeso(grandTotal)}</span>
          </div>
        </div>

        {allPayments.length > 0 && (
          <>
            <hr className="my-2 border-dashed border-line" />
            <div className="space-y-0.5">
              {allPayments.map((pay) => (
                <div key={pay.id} className="flex justify-between gap-2">
                  <span>{pay.payment_methods?.name ?? "Payment"}</span>
                  <span>{formatPeso(pay.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between gap-2 font-semibold">
                <span>Total paid</span>
                <span>{formatPeso(paidTotal)}</span>
              </div>
              {grandTotal - paidTotal > 0.005 && (
                <div className="flex justify-between gap-2 font-semibold">
                  <span>Balance</span>
                  <span>{formatPeso(grandTotal - paidTotal)}</span>
                </div>
              )}
            </div>
          </>
        )}

        {receipt.footer && (
          <>
            <hr className="my-2 border-dashed border-line" />
            <p className="text-center">{receipt.footer}</p>
          </>
        )}
      </div>
    </main>
  );
}
