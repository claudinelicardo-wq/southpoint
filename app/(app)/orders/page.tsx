import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  OrdersManager,
  type OrderListRow,
  type PaymentMethod,
  type TabOrderRow,
  type TabRow,
} from "./orders-manager";

export const metadata = { title: "Orders" };

/** Tabs closed before this instant are no longer interesting for reopening. */
function closedTabCutoff(): string {
  return new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
}

export default async function OrdersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "orders.view")) {
    redirect("/dashboard");
  }

  let tabs: TabRow[] = [];
  let tabOrders: TabOrderRow[] = [];
  let orders: OrderListRow[] = [];
  let methods: PaymentMethod[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const cutoff = closedTabCutoff();
    const [t, to, o, m] = await Promise.all([
      // Open tabs plus tabs closed in the last 48h (for the reopen list).
      supabase
        .from("tabs")
        .select("id, name, status, opened_at, closed_at")
        .or(`status.eq.open,closed_at.gte.${cutoff}`)
        .order("opened_at", { ascending: false }),
      // Completed tab orders — balances are computed client-side.
      supabase
        .from("orders")
        .select("id, tab_id, total, amount_paid")
        .not("tab_id", "is", null)
        .eq("status", "completed"),
      supabase
        .from("orders")
        .select(
          "id, order_number, order_type, status, payment_status, total, created_at, courtside_label, customers(full_name), tabs(name)",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("payment_methods")
        .select("id, code, name, kind, requires_reference, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order"),
    ]);
    tabs = (t.data as TabRow[] | null) ?? [];
    tabOrders = (to.data as TabOrderRow[] | null) ?? [];
    orders = (o.data as unknown as OrderListRow[] | null) ?? [];
    methods = (m.data as PaymentMethod[] | null) ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Open tabs, recent orders, and settlements. Completed sales are read-only here."
      />
      <OrdersManager
        tabs={tabs}
        tabOrders={tabOrders}
        orders={orders}
        methods={methods}
        canSettle={can(session.permissions, session.profile.role, "tabs.manage")}
        canReopen={can(session.permissions, session.profile.role, "tabs.reopen")}
        preview={session.preview}
      />
    </div>
  );
}
