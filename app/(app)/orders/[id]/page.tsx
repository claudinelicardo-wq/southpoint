import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatPeso, formatQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type {
  OrderStatus,
  OrderType,
  PaymentStatus,
} from "../orders-manager";
import { OrderActions } from "./order-actions";

export const metadata = { title: "Order" };

// Badge maps live here too — orders-manager is a client module, so its runtime
// exports cannot be imported into a server component.
type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TYPE_BADGES: Record<OrderType, { tone: BadgeTone; label: string }> = {
  dine_in: { tone: "neutral", label: "Dine-in" },
  takeaway: { tone: "info", label: "Takeaway" },
  courtside: { tone: "accent", label: "Courtside" },
  tab: { tone: "info", label: "Tab" },
};

const PAYMENT_BADGES: Record<PaymentStatus, { tone: BadgeTone; label: string }> = {
  paid: { tone: "success", label: "Paid" },
  partial: { tone: "warning", label: "Partial" },
  unpaid: { tone: "danger", label: "Unpaid" },
};

const STATUS_BADGES: Record<OrderStatus, { tone: BadgeTone; label: string }> = {
  completed: { tone: "success", label: "Completed" },
  open: { tone: "warning", label: "Open" },
  held: { tone: "warning", label: "Held" },
  voided: { tone: "danger", label: "Voided" },
  cancelled: { tone: "danger", label: "Cancelled" },
};

const DISCOUNT_LABELS: Record<string, string> = {
  percent: "Percent discount",
  fixed: "Fixed discount",
  senior: "Senior Citizen",
  pwd: "PWD",
  loyalty: "Loyalty",
  promo: "Promo",
  comp: "Complimentary",
  manual: "Manual discount",
};

interface OrderDetail {
  id: string;
  order_number: string;
  order_type: OrderType;
  status: OrderStatus;
  payment_status: PaymentStatus;
  courtside_label: string | null;
  notes: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  service_charge: number;
  total: number;
  amount_paid: number;
  refund_total: number;
  void_reason: string | null;
  created_at: string;
  completed_at: string | null;
  customers: { full_name: string } | null;
  tabs: { name: string } | null;
  profiles: { full_name: string } | null;
}

interface OrderItemRow {
  id: string;
  product_name: string;
  variant_name: string | null;
  qty: number;
  unit_price: number;
  modifiers_price: number;
  line_total: number;
  notes: string | null;
  order_item_modifiers: {
    id: string;
    option_name: string;
    group_name: string;
    price_delta: number;
  }[];
}

interface OrderDiscountRow {
  id: string;
  discount_type: string;
  amount: number;
  reason: string | null;
  id_reference: string | null;
}

interface PaymentRow {
  id: string;
  amount: number;
  reference_no: string | null;
  tendered: number | null;
  change: number | null;
  status: string;
  created_at: string;
  payment_methods: { name: string } | null;
}

export default async function OrderDetailPage({
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
  const { data: order } = await supabase
    .from("orders")
    .select("*, customers(full_name), tabs(name), profiles(full_name)")
    .eq("id", id)
    .maybeSingle<OrderDetail>();
  if (!order) notFound();

  const [i, d, p, m] = await Promise.all([
    supabase
      .from("order_items")
      .select("*, order_item_modifiers(*)")
      .eq("order_id", id)
      .order("created_at"),
    supabase
      .from("order_discounts")
      .select("*")
      .eq("order_id", id)
      .order("created_at"),
    supabase
      .from("payments")
      .select("*, payment_methods(name)")
      .eq("order_id", id)
      .order("created_at"),
    supabase
      .from("payment_methods")
      .select("code, name")
      .eq("is_active", true)
      .order("sort_order"),
  ]);
  const items = (i.data as unknown as OrderItemRow[] | null) ?? [];
  const discounts = (d.data as OrderDiscountRow[] | null) ?? [];
  const payments = (p.data as unknown as PaymentRow[] | null) ?? [];
  const refundMethods = (m.data as { code: string; name: string }[] | null) ?? [];

  const balance = Number(order.total) - Number(order.amount_paid);
  const refundableAmount = Number(order.amount_paid) - Number(order.refund_total);
  const canVoid =
    order.status === "completed" &&
    can(session.permissions, session.profile.role, "pos.void");
  const canRefund =
    order.status === "completed" &&
    can(session.permissions, session.profile.role, "pos.refund");
  const context = order.tabs?.name
    ? `Tab · ${order.tabs.name}`
    : order.courtside_label
      ? `Courtside · ${order.courtside_label}`
      : order.customers?.full_name
        ? `Customer · ${order.customers.full_name}`
        : null;

  const meta: { label: string; value: string }[] = [
    { label: "Type", value: TYPE_BADGES[order.order_type].label },
    { label: "Cashier", value: order.profiles?.full_name ?? "—" },
    { label: "Created", value: formatDateTime(order.created_at) },
    {
      label: "Completed",
      value: order.completed_at ? formatDateTime(order.completed_at) : "—",
    },
  ];
  if (context) {
    const [label, value] = context.split(" · ");
    meta.push({ label, value });
  }
  if (order.notes) meta.push({ label: "Notes", value: order.notes });
  if (order.void_reason) meta.push({ label: "Void / cancel reason", value: order.void_reason });

  const totals: { label: string; value: string; bold?: boolean }[] = [
    { label: "Subtotal", value: formatPeso(order.subtotal) },
    ...discounts.map((disc) => ({
      label: [
        DISCOUNT_LABELS[disc.discount_type] ?? disc.discount_type,
        disc.reason,
      ]
        .filter(Boolean)
        .join(" · "),
      value: `−${formatPeso(disc.amount)}`,
    })),
    ...(Number(order.tax_total) > 0
      ? [{ label: "VAT", value: formatPeso(order.tax_total) }]
      : []),
    ...(Number(order.service_charge) > 0
      ? [{ label: "Service charge", value: formatPeso(order.service_charge) }]
      : []),
    { label: "Total", value: formatPeso(order.total), bold: true },
    { label: "Amount paid", value: formatPeso(order.amount_paid) },
    ...(Number(order.refund_total) > 0
      ? [{ label: "Refunded", value: `−${formatPeso(order.refund_total)}` }]
      : []),
    { label: "Balance", value: formatPeso(balance) },
  ];

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/orders"
          className="text-sm text-latte underline-offset-2 hover:text-roast hover:underline"
        >
          &larr; Back to orders
        </Link>
      </div>
      <PageHeader
        title={`Order ${order.order_number}`}
        description={context ?? undefined}
        actions={
          <>
            <Badge tone={STATUS_BADGES[order.status].tone}>
              {STATUS_BADGES[order.status].label}
            </Badge>
            <Badge tone={PAYMENT_BADGES[order.payment_status].tone}>
              {PAYMENT_BADGES[order.payment_status].label}
            </Badge>
            <Link
              href={`/receipt/${order.id}`}
              className="text-sm font-medium text-court underline-offset-2 hover:underline"
            >
              View receipt
            </Link>
            <OrderActions
              orderId={order.id}
              refundableAmount={refundableAmount}
              hasRefunds={Number(order.refund_total) > 0}
              canVoid={canVoid}
              canRefund={canRefund}
              methods={refundMethods}
            />
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {meta.map((row) => (
                <div key={row.label}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-latte">
                    {row.label}
                  </dt>
                  <dd className="mt-0.5 text-sm text-espresso">{row.value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-espresso">
            Items
          </h2>
          {items.length === 0 ? (
            <EmptyState title="No items" />
          ) : (
            <Table>
              <THead>
                <TH>Item</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Unit price</TH>
                <TH className="text-right">Line total</TH>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <p className="font-medium text-espresso">
                        {item.product_name}
                        {item.variant_name && (
                          <span className="text-latte"> · {item.variant_name}</span>
                        )}
                      </p>
                      {item.order_item_modifiers.map((mod) => (
                        <p key={mod.id} className="mt-0.5 text-xs text-latte">
                          + {mod.option_name}
                          {Number(mod.price_delta) !== 0 &&
                            ` (${formatPeso(mod.price_delta)})`}
                        </p>
                      ))}
                      {item.notes && (
                        <p className="mt-0.5 text-xs italic text-latte">
                          “{item.notes}”
                        </p>
                      )}
                    </TD>
                    <TD className="text-right text-espresso">{formatQty(item.qty)}</TD>
                    <TD className="text-right text-latte">
                      {formatPeso(Number(item.unit_price) + Number(item.modifiers_price))}
                    </TD>
                    <TD className="text-right font-medium text-espresso">
                      {formatPeso(item.line_total)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>

        <Card className="max-w-md">
          <CardHeader title="Totals" />
          <CardBody>
            <dl className="space-y-2">
              {totals.map((row, idx) => (
                <div
                  key={`${row.label}-${idx}`}
                  className={
                    row.bold
                      ? "flex items-baseline justify-between border-t border-line pt-2 font-semibold text-espresso"
                      : "flex items-baseline justify-between text-sm text-roast"
                  }
                >
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-espresso">
            Payments
          </h2>
          {payments.length === 0 ? (
            <EmptyState
              title="No payments"
              description="No payments have been recorded against this order."
            />
          ) : (
            <Table>
              <THead>
                <TH>Method</TH>
                <TH className="text-right">Amount</TH>
                <TH>Reference</TH>
                <TH className="text-right">Tendered / Change</TH>
                <TH>Time</TH>
              </THead>
              <TBody>
                {payments.map((pay) => (
                  <TR key={pay.id}>
                    <TD className="font-medium text-espresso">
                      {pay.payment_methods?.name ?? "—"}
                      {pay.status !== "posted" && (
                        <Badge tone="danger" className="ml-2">
                          {pay.status}
                        </Badge>
                      )}
                    </TD>
                    <TD className="text-right text-espresso">
                      {formatPeso(pay.amount)}
                    </TD>
                    <TD className="text-latte">{pay.reference_no ?? "—"}</TD>
                    <TD className="text-right text-latte">
                      {pay.tendered !== null
                        ? `${formatPeso(pay.tendered)} / ${formatPeso(pay.change ?? 0)}`
                        : "—"}
                    </TD>
                    <TD className="whitespace-nowrap text-latte">
                      {formatDateTime(pay.created_at)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      </div>
    </div>
  );
}
