import { formatDateTime, formatPeso, formatQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import type { OrderStatus, OrderType, PaymentStatus } from "../../(app)/orders/orders-manager";
import { ReceiptActions } from "./receipt-actions";

export const metadata = { title: "Receipt" };

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

interface ReceiptOrder {
  id: string;
  order_number: string;
  order_type: OrderType;
  status: OrderStatus;
  payment_status: PaymentStatus;
  courtside_label: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  service_charge: number;
  total: number;
  amount_paid: number;
  created_at: string;
  completed_at: string | null;
  customers: { full_name: string } | null;
  tabs: { name: string } | null;
  profiles: { full_name: string } | null;
  order_items: {
    id: string;
    product_name: string;
    variant_name: string | null;
    qty: number;
    line_total: number;
    created_at: string;
    order_item_modifiers: {
      id: string;
      option_name: string;
      price_delta: number;
    }[];
  }[];
  order_discounts: {
    id: string;
    discount_type: string;
    amount: number;
    reason: string | null;
  }[];
  payments: {
    id: string;
    amount: number;
    reference_no: string | null;
    tendered: number | null;
    change: number | null;
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

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "orders.view")) {
    redirect("/dashboard");
  }
  // No data exists in preview mode, so any order id is unknown.
  if (session.preview) notFound();

  const supabase = await createClient();
  const [o, s] = await Promise.all([
    supabase
      .from("orders")
      .select(
        `*, customers(full_name), tabs(name), profiles(full_name),
         order_items(*, order_item_modifiers(*)),
         order_discounts(*),
         payments(*, payment_methods(name))`,
      )
      .eq("id", id)
      .maybeSingle<ReceiptOrder>(),
    supabase
      .from("settings")
      .select("key, value")
      .in("key", ["business_profile", "receipt", "tax"]),
  ]);
  const order = o.data;
  if (!order) notFound();

  const settings = new Map(
    ((s.data as { key: string; value: Record<string, unknown> }[] | null) ?? []).map(
      (row) => [row.key, row.value],
    ),
  );
  const business = (settings.get("business_profile") ?? {}) as BusinessProfile;
  const receipt = (settings.get("receipt") ?? {}) as ReceiptSettings;
  const widthMm = Number(receipt.width_mm) || 58;

  const items = [...order.order_items].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const payments = [...order.payments].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const context = order.tabs?.name
    ? `Tab: ${order.tabs.name}`
    : order.courtside_label
      ? `Courtside: ${order.courtside_label}`
      : order.customers?.full_name
        ? `Customer: ${order.customers.full_name}`
        : null;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-4 py-8">
      <ReceiptActions orderId={order.id} />

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

        {/* Order meta */}
        <div className="space-y-0.5">
          <div className="flex justify-between gap-2">
            <span>{order.order_number}</span>
            <span>{TYPE_LABELS[order.order_type]}</span>
          </div>
          <p>{formatDateTime(order.completed_at ?? order.created_at)}</p>
          <p>Cashier: {order.profiles?.full_name ?? "—"}</p>
          {context && <p>{context}</p>}
        </div>

        <hr className="my-2 border-dashed border-line" />

        {/* Items */}
        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.id}>
              <div className="flex justify-between gap-2">
                <span>
                  {formatQty(item.qty)} x {item.product_name}
                  {item.variant_name && ` (${item.variant_name})`}
                </span>
                <span className="shrink-0 text-right">
                  {formatPeso(item.line_total)}
                </span>
              </div>
              {item.order_item_modifiers.map((mod) => (
                <p key={mod.id} className="pl-4">
                  + {mod.option_name}
                  {Number(mod.price_delta) !== 0 && ` +${formatPeso(mod.price_delta)}`}
                </p>
              ))}
            </div>
          ))}
        </div>

        <hr className="my-2 border-dashed border-line" />

        {/* Totals */}
        <div className="space-y-0.5">
          <div className="flex justify-between gap-2">
            <span>Subtotal</span>
            <span>{formatPeso(order.subtotal)}</span>
          </div>
          {order.order_discounts.map((disc) => (
            <div key={disc.id} className="flex justify-between gap-2">
              <span>
                {DISCOUNT_LABELS[disc.discount_type] ?? disc.discount_type}
                {disc.reason && ` (${disc.reason})`}
              </span>
              <span>−{formatPeso(disc.amount)}</span>
            </div>
          ))}
          {Number(order.tax_total) > 0 && (
            <div className="flex justify-between gap-2">
              <span>VAT</span>
              <span>{formatPeso(order.tax_total)}</span>
            </div>
          )}
          {Number(order.service_charge) > 0 && (
            <div className="flex justify-between gap-2">
              <span>Service charge</span>
              <span>{formatPeso(order.service_charge)}</span>
            </div>
          )}
          <div className="flex justify-between gap-2 text-sm font-bold">
            <span>TOTAL</span>
            <span>{formatPeso(order.total)}</span>
          </div>
        </div>

        {payments.length > 0 && (
          <>
            <hr className="my-2 border-dashed border-line" />
            <div className="space-y-0.5">
              {payments.map((pay) => (
                <div key={pay.id}>
                  <div className="flex justify-between gap-2">
                    <span>{pay.payment_methods?.name ?? "Payment"}</span>
                    <span>{formatPeso(pay.amount)}</span>
                  </div>
                  {pay.reference_no && <p className="pl-4">Ref: {pay.reference_no}</p>}
                  {pay.tendered !== null && (
                    <p className="pl-4">
                      Tendered {formatPeso(pay.tendered)} · Change{" "}
                      {formatPeso(pay.change ?? 0)}
                    </p>
                  )}
                </div>
              ))}
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
