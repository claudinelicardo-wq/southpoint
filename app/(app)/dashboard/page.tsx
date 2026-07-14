import { CourtWidget, type CourtSession } from "@/components/court-widget";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPeso, formatQty } from "@/lib/format";
import { can, visibleNav } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata = { title: "Dashboard" };

/** Today's boundaries in Asia/Manila (+08:00, no DST). */
function manilaToday(): { from: string; to: string; label: string } {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    dateStyle: "short",
  }).format(now); // YYYY-MM-DD
  return {
    from: `${day}T00:00:00+08:00`,
    to: `${day}T23:59:59.999+08:00`,
    label: day,
  };
}

// Date math kept in module-level plain helpers (not inside the component) so
// the react-hooks purity rule doesn't flag the clock read.
const DAY_MS = 86_400_000;

/** ISO timestamp for the start of the 7-day trend window (6 days ago). */
function weekAgoISO(): string {
  return new Date(Date.now() - 6 * DAY_MS).toISOString();
}

/** The seven Asia/Manila day keys (YYYY-MM-DD) covering the trend window. */
function weekTrendDays(): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", dateStyle: "short" });
  const nowMs = Date.now();
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) days.push(fmt.format(new Date(nowMs - i * DAY_MS)));
  return days;
}

/** Date (YYYY-MM-DD) seven days out — the "expiring soon" cutoff. */
function expiryCutoff(): string {
  return new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { profile, permissions } = session;
  const c = (p: Parameters<typeof can>[2]) => can(permissions, profile.role, p);

  const hour = Number(
    new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const quickLinks = visibleNav(profile.role, permissions).filter((n) =>
    ["/pos", "/kds", "/inventory", "/purchasing", "/reports", "/shifts"].includes(n.href),
  );

  // ---------------------------------------------------------------- data
  let sales: {
    gross: number;
    orders: number;
    aov: number;
    cogs: number;
    byMethod: { name: string; amount: number }[];
  } | null = null;
  let openTabs: { id: string; name: string; balance: number }[] = [];
  let lowStock: { id: string; name: string; current_stock: number; reorder_level: number; base_unit: string }[] = [];
  let expiring: { name: string; expires_at: string; qty_remaining: number }[] = [];
  let wasteToday = 0;
  let topSellers: { name: string; qty: number; revenue: number }[] = [];
  let payables = 0;
  let court: CourtSession | null = null;
  let tabOptions: { id: string; name: string }[] = [];
  let trend: { day: string; total: number }[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const today = manilaToday();

    if (c("reports.sales")) {
      const [ordersRes, paymentsRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id, total, cogs_total")
          .eq("status", "completed")
          .gte("completed_at", today.from)
          .lte("completed_at", today.to),
        supabase
          .from("payments")
          .select("amount, payment_methods(name)")
          .eq("status", "posted")
          .gte("created_at", today.from)
          .lte("created_at", today.to),
      ]);
      const orders = ordersRes.data ?? [];
      const gross = orders.reduce((s, o) => s + Number(o.total), 0);
      const cogs = orders.reduce((s, o) => s + Number(o.cogs_total), 0);
      const byMethod = new Map<string, number>();
      for (const p of paymentsRes.data ?? []) {
        const name =
          (p.payment_methods as unknown as { name: string } | null)?.name ?? "Other";
        byMethod.set(name, (byMethod.get(name) ?? 0) + Number(p.amount));
      }
      sales = {
        gross,
        orders: orders.length,
        aov: orders.length ? gross / orders.length : 0,
        cogs,
        byMethod: [...byMethod.entries()].map(([name, amount]) => ({ name, amount })),
      };

      // 7-day trend
      const { data: weekOrders } = await supabase
        .from("orders")
        .select("total, completed_at")
        .eq("status", "completed")
        .gte("completed_at", weekAgoISO());
      const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", dateStyle: "short" });
      const byDay = new Map<string, number>();
      for (const day of weekTrendDays()) byDay.set(day, 0);
      for (const o of weekOrders ?? []) {
        const d = fmt.format(new Date(o.completed_at as string));
        if (byDay.has(d)) byDay.set(d, (byDay.get(d) ?? 0) + Number(o.total));
      }
      trend = [...byDay.entries()].map(([day, total]) => ({ day: day.slice(5), total }));
    }

    if (c("tabs.manage") || c("orders.view")) {
      const [{ data: tabs }, { data: tabOrders }] = await Promise.all([
        supabase.from("tabs").select("id, name").eq("status", "open"),
        supabase
          .from("orders")
          .select("tab_id, total, amount_paid")
          .eq("status", "completed")
          .not("tab_id", "is", null)
          .neq("payment_status", "paid"),
      ]);
      tabOptions = tabs ?? [];
      openTabs = (tabs ?? []).map((t) => ({
        ...t,
        balance: (tabOrders ?? [])
          .filter((o) => o.tab_id === t.id)
          .reduce((s, o) => s + Number(o.total) - Number(o.amount_paid), 0),
      }));
    }

    if (c("inventory.view")) {
      const [{ data: items }, { data: batches }, { data: waste }] = await Promise.all([
        supabase
          .from("inventory_items")
          .select("id, name, current_stock, reorder_level, base_unit")
          .is("archived_at", null)
          .gt("reorder_level", 0),
        supabase
          .from("inventory_batches")
          .select("expires_at, qty_remaining, inventory_items(name)")
          .gt("qty_remaining", 0)
          .not("expires_at", "is", null)
          .lte("expires_at", expiryCutoff())
          .order("expires_at")
          .limit(8),
        supabase
          .from("waste_records")
          .select("cost")
          .eq("status", "approved")
          .gte("created_at", today.from),
      ]);
      lowStock = (items ?? [])
        .filter((i) => Number(i.current_stock) <= Number(i.reorder_level))
        .slice(0, 8);
      expiring = (batches ?? []).map((b) => ({
        name: (b.inventory_items as unknown as { name: string } | null)?.name ?? "",
        expires_at: b.expires_at as string,
        qty_remaining: Number(b.qty_remaining),
      }));
      wasteToday = (waste ?? []).reduce((s, w) => s + Number(w.cost ?? 0), 0);
    }

    if (c("reports.sales")) {
      const { data: itemsToday } = await supabase
        .from("order_items")
        .select("product_name, qty, line_total, orders!inner(status, completed_at)")
        .eq("orders.status", "completed")
        .gte("orders.completed_at", today.from);
      const top = new Map<string, { qty: number; revenue: number }>();
      for (const i of itemsToday ?? []) {
        const t = top.get(i.product_name) ?? { qty: 0, revenue: 0 };
        t.qty += Number(i.qty);
        t.revenue += Number(i.line_total);
        top.set(i.product_name, t);
      }
      topSellers = [...top.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
    }

    if (c("purchasing.view")) {
      const { data: pay } = await supabase.from("v_po_payables").select("balance");
      payables = (pay ?? []).reduce((s, p) => s + Math.max(0, Number(p.balance)), 0);
    }

    {
      const { data: courtData } = await supabase
        .from("court_sessions")
        .select("*, tabs(name)")
        .is("ended_at", null)
        .maybeSingle();
      court = (courtData as CourtSession | null) ?? null;
    }
  }

  const maxTrend = Math.max(1, ...trend.map((t) => t.total));

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${profile.full_name.split(" ")[0] || "there"}`}
        description="Here's what's happening at South Point today."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="tap rounded-(--radius-card) border border-line bg-paper px-4 py-4 text-center font-medium text-roast shadow-(--shadow-card) transition-colors hover:border-court hover:text-court-deep"
          >
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {sales && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Gross sales today" value={formatPeso(sales.gross)} />
              <Stat label="Orders" value={String(sales.orders)} />
              <Stat label="Average order" value={formatPeso(sales.aov)} />
              <Stat
                label="Est. gross profit"
                value={formatPeso(sales.gross - sales.cogs)}
                hint={c("reports.profit") ? `COGS ${formatPeso(sales.cogs)}` : undefined}
              />
            </div>
          )}

          {sales && trend.length > 0 && (
            <Card>
              <CardHeader title="Last 7 days" />
              <CardBody>
                <div className="flex h-28 items-end gap-2">
                  {trend.map((t) => (
                    <div key={t.day} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-md bg-court/70"
                        style={{ height: `${Math.max(3, (t.total / maxTrend) * 100)}%` }}
                        title={formatPeso(t.total)}
                      />
                      <span className="text-[10px] text-latte">{t.day}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {sales && sales.byMethod.length > 0 && (
            <Card>
              <CardHeader title="Payments today" />
              <CardBody className="flex flex-wrap gap-4">
                {sales.byMethod.map((m) => (
                  <div key={m.name}>
                    <p className="text-xs text-latte">{m.name}</p>
                    <p className="font-semibold text-espresso">{formatPeso(m.amount)}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          {topSellers.length > 0 && (
            <Card>
              <CardHeader title="Top sellers today" />
              <CardBody>
                <ul className="space-y-1.5">
                  {topSellers.map((t) => (
                    <li key={t.name} className="flex items-center justify-between text-sm">
                      <span className="text-roast">
                        {t.name} <span className="text-latte">× {formatQty(t.qty)}</span>
                      </span>
                      <span className="font-medium">{formatPeso(t.revenue)}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {sales && sales.orders === 0 && (
            <EmptyState
              title="No sales yet today"
              description="Completed POS sales will appear here in real numbers, never demo data."
            />
          )}
        </div>

        <div className="space-y-4">
          <CourtWidget
            session={court}
            openTabs={tabOptions}
            canManage={c("court.manage") && !session.preview}
            compact
          />

          {openTabs.length > 0 && (
            <Card>
              <CardHeader title="Open tabs" />
              <CardBody>
                <ul className="space-y-1.5">
                  {openTabs.map((t) => (
                    <li key={t.id} className="flex items-center justify-between text-sm">
                      <span className="text-roast">{t.name}</span>
                      <span className={t.balance > 0 ? "font-medium text-clay" : "text-latte"}>
                        {formatPeso(t.balance)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {c("inventory.view") && (
            <Card>
              <CardHeader title="Stock alerts" />
              <CardBody>
                {lowStock.length === 0 && expiring.length === 0 ? (
                  <p className="text-sm text-latte">All stock levels look healthy.</p>
                ) : (
                  <div className="space-y-3">
                    {lowStock.length > 0 && (
                      <ul className="space-y-1">
                        {lowStock.map((i) => (
                          <li key={i.id} className="flex items-center justify-between text-sm">
                            <Link href={`/inventory/${i.id}`} className="text-roast hover:text-court-deep">
                              {i.name}
                            </Link>
                            <Badge tone={Number(i.current_stock) <= 0 ? "danger" : "warning"}>
                              {Number(i.current_stock) <= 0
                                ? "Out"
                                : `${formatQty(i.current_stock)} ${i.base_unit}`}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    {expiring.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-latte">
                          Expiring soon
                        </p>
                        <ul className="space-y-1">
                          {expiring.map((b, i) => (
                            <li key={i} className="flex items-center justify-between text-sm">
                              <span className="text-roast">{b.name}</span>
                              <span className="text-xs text-amber">{b.expires_at}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {wasteToday > 0 && (
                  <p className="mt-3 border-t border-line pt-2 text-sm text-roast">
                    Waste today: <span className="font-medium text-danger">{formatPeso(wasteToday)}</span>
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          {c("purchasing.view") && payables > 0 && (
            <Card>
              <CardHeader title="Supplier payables" />
              <CardBody>
                <p className="text-2xl font-semibold text-espresso">{formatPeso(payables)}</p>
                <Link href="/purchasing" className="text-sm text-court-deep underline">
                  Review purchase orders
                </Link>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-(--radius-card) border border-line bg-paper px-4 py-3 shadow-(--shadow-card)">
      <p className="text-xs text-latte">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-espresso">{value}</p>
      {hint && <p className="text-xs text-latte">{hint}</p>}
    </div>
  );
}
