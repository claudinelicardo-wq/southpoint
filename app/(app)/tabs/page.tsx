import { PageHeader } from "@/components/ui/card";
import { manilaDateKey } from "@/lib/format";
import { isYMD, periodInstants, type PeriodView } from "@/lib/periods";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { PaymentMethod } from "../orders/orders-manager";
import { TabsManager, type TabHistoryOrder, type TabInfo, type TabsView } from "./tabs-manager";

export const metadata = { title: "Tabs" };

const VIEWS: TabsView[] = ["day", "week", "month", "unpaid"];

export default async function TabsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "orders.view")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const view: TabsView = VIEWS.includes(params.view as TabsView)
    ? (params.view as TabsView)
    : "day";
  const today = manilaDateKey(new Date().toISOString());
  const anchor = isYMD(params.date) ? params.date : today;

  let orders: TabHistoryOrder[] = [];
  let balances: Record<string, number> = {};
  let tabs: TabInfo[] = [];
  let methods: PaymentMethod[] = [];
  let gcashQrImage: string | null = null;

  if (!session.preview) {
    const supabase = await createClient();

    let ordersQuery = supabase
      .from("orders")
      .select("id, order_number, tab_id, total, amount_paid, payment_status, created_at")
      .not("tab_id", "is", null)
      .eq("status", "completed")
      .order("created_at", { ascending: true })
      .limit(2000);
    if (view === "unpaid") {
      ordersQuery = ordersQuery.neq("payment_status", "paid");
    } else {
      const { from, to } = periodInstants(view as PeriodView, anchor);
      ordersQuery = ordersQuery.gte("created_at", from).lt("created_at", to);
    }

    const [o, outstanding, m, receipt] = await Promise.all([
      ordersQuery,
      // Every unpaid tab order, all-time — this is what a settle pays down.
      supabase
        .from("orders")
        .select("tab_id, total, amount_paid")
        .not("tab_id", "is", null)
        .eq("status", "completed")
        .neq("payment_status", "paid"),
      supabase
        .from("payment_methods")
        .select("id, code, name, kind, requires_reference, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order"),
      supabase.from("settings").select("value").eq("key", "receipt").single(),
    ]);

    orders = (o.data as TabHistoryOrder[] | null) ?? [];
    for (const row of outstanding.data ?? []) {
      const id = row.tab_id as string;
      balances[id] = (balances[id] ?? 0) + Number(row.total) - Number(row.amount_paid);
    }
    balances = Object.fromEntries(
      Object.entries(balances).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    );

    const tabIds = [...new Set([...orders.map((r) => r.tab_id), ...Object.keys(balances)])];
    if (tabIds.length > 0) {
      const { data } = await supabase
        .from("tabs")
        .select("id, name, status, opened_at, closed_at")
        .in("id", tabIds);
      tabs = (data as TabInfo[] | null) ?? [];
    }
    methods = (m.data as PaymentMethod[] | null) ?? [];
    gcashQrImage =
      (receipt.data?.value as { gcash_qr_image?: string } | null)?.gcash_qr_image ?? null;
  }

  return (
    <div>
      <PageHeader
        title="Tabs"
        description="Every tab bill by day, week, or month — including older unpaid balances. Settling pays the oldest unpaid orders first."
      />
      <TabsManager
        view={view}
        anchor={anchor}
        today={today}
        orders={orders}
        balances={balances}
        tabs={tabs}
        methods={methods}
        gcashQrImage={gcashQrImage}
        canSettle={can(session.permissions, session.profile.role, "tabs.manage")}
        preview={session.preview}
      />
    </div>
  );
}
