"use client";

import { GcashQr } from "@/components/gcash-qr";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatPeso, formatTime, manilaDateKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Row shapes (mirrors supabase/migrations/0003_pos.sql)
// ---------------------------------------------------------------------------

export type OrderType = "dine_in" | "takeaway" | "courtside" | "tab";
export type OrderStatus = "open" | "held" | "completed" | "voided" | "cancelled";
export type PaymentStatus = "unpaid" | "partial" | "paid";

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  kind: "cash" | "ewallet" | "card" | "bank" | "comp" | "other";
  requires_reference: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface TabRow {
  id: string;
  name: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
}

/** Completed orders attached to a tab — used to compute outstanding balances. */
export interface TabOrderRow {
  id: string;
  tab_id: string;
  total: number;
  amount_paid: number;
}

export interface OrderListRow {
  id: string;
  order_number: string;
  order_type: OrderType;
  status: OrderStatus;
  payment_status: PaymentStatus;
  total: number;
  amount_paid: number;
  created_at: string;
  tab_id: string | null;
  courtside_label: string | null;
  customers: { full_name: string } | null;
  tabs: { name: string } | null;
  payments: { status: string; payment_methods: { code: string; name: string } | null }[];
}

/** Distinct method names posted against an order (voided payments excluded). */
function orderMethods(o: OrderListRow): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of o.payments ?? []) {
    if (p.status !== "posted") continue;
    if (p.payment_methods) seen.set(p.payment_methods.code, p.payment_methods.name);
  }
  return [...seen.entries()].map(([code, name]) => ({ code, name }));
}

// ---------------------------------------------------------------------------
// Badge maps
// ---------------------------------------------------------------------------

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

type Filter = "all" | "active" | "completed" | "voided";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "voided", label: "Voided + Cancelled" },
];

function matchesFilter(o: OrderListRow, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return (
        o.status === "open" ||
        o.status === "held" ||
        (o.status === "completed" &&
          (o.payment_status === "unpaid" || o.payment_status === "partial"))
      );
    case "completed":
      return o.status === "completed";
    case "voided":
      return o.status === "voided" || o.status === "cancelled";
  }
}

/** Closed within the last 24h — eligible for the reopen list. */
function closedRecently(tab: TabRow): boolean {
  return (
    tab.status === "closed" &&
    tab.closed_at !== null &&
    Date.now() - new Date(tab.closed_at).getTime() <= 24 * 60 * 60 * 1000
  );
}

function orderContext(o: OrderListRow): string {
  if (o.tabs?.name) return o.tabs.name;
  if (o.courtside_label) return o.courtside_label;
  if (o.customers?.full_name) return o.customers.full_name;
  return "—";
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export function OrdersManager({
  tabs,
  tabOrders,
  orders,
  methods,
  gcashQrImage,
  canSettle,
  canReopen,
  preview,
}: {
  tabs: TabRow[];
  tabOrders: TabOrderRow[];
  orders: OrderListRow[];
  methods: PaymentMethod[];
  gcashQrImage: string | null;
  canSettle: boolean;
  canReopen: boolean;
  preview: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [settling, setSettling] = useState<TabRow | null>(null);
  const [reopening, setReopening] = useState<TabRow | null>(null);
  const [cancelling, setCancelling] = useState<OrderListRow | null>(null);
  const [viewingTab, setViewingTab] = useState<TabRow | null>(null);

  const tabStats = useMemo(() => {
    const map = new Map<string, { balance: number; count: number }>();
    for (const o of tabOrders) {
      const s = map.get(o.tab_id) ?? { balance: 0, count: 0 };
      s.balance += Number(o.total) - Number(o.amount_paid);
      s.count += 1;
      map.set(o.tab_id, s);
    }
    return map;
  }, [tabOrders]);

  const openTabs = tabs.filter((t) => t.status === "open");
  const recentlyClosed = canReopen ? tabs.filter(closedRecently) : [];

  const filtered = orders.filter(
    (o) =>
      matchesFilter(o, filter) &&
      (methodFilter === "all" || orderMethods(o).some((m) => m.code === methodFilter)),
  );

  return (
    <div className="space-y-8">
      {preview && (
        <Alert tone="warning">
          Orders need a connected Supabase project.
        </Alert>
      )}

      {openTabs.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-espresso">
            Open tabs
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {openTabs.map((tab) => {
              const stats = tabStats.get(tab.id) ?? { balance: 0, count: 0 };
              return (
                <Card key={tab.id}>
                  <CardBody>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-espresso">{tab.name}</p>
                        <p className="mt-0.5 text-xs text-latte">
                          Opened {formatTime(tab.opened_at)} ·{" "}
                          {stats.count === 1 ? "1 order" : `${stats.count} orders`}
                        </p>
                      </div>
                      <Badge tone={stats.balance > 0 ? "warning" : "success"}>
                        {stats.balance > 0 ? "Unsettled" : "Settled"}
                      </Badge>
                    </div>
                    <p className="mt-3 text-lg font-semibold text-espresso">
                      {formatPeso(stats.balance)}
                      <span className="ml-1 text-xs font-normal text-latte">balance</span>
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setViewingTab(tab)}>
                        View orders
                      </Button>
                      {canSettle && stats.balance > 0 && (
                        <Button size="sm" onClick={() => setSettling(tab)}>
                          Settle
                        </Button>
                      )}
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {recentlyClosed.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-espresso">
            Recently closed tabs
          </h2>
          <div className="space-y-2">
            {recentlyClosed.map((tab) => (
              <Card key={tab.id}>
                <CardBody className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-espresso">{tab.name}</p>
                    <p className="text-xs text-latte">
                      Closed {tab.closed_at ? formatTime(tab.closed_at) : "—"}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setReopening(tab)}>
                    Reopen
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-espresso">
            Recent orders
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "secondary" : "ghost"}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
            <Select
              className="h-8 w-auto py-0 text-sm"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              aria-label="Filter by payment method"
            >
              <option value="all">Any payment</option>
              {methods.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={orders.length === 0 ? "No orders yet" : "No matching orders"}
            description={
              orders.length === 0
                ? "Orders posted from the POS will show up here."
                : "Try a different filter."
            }
          />
        ) : (
          <Table>
            <THead>
              <TH>Order</TH>
              <TH>Time</TH>
              <TH>Type</TH>
              <TH>Customer / Tab</TH>
              <TH className="text-right">Total</TH>
              <TH>Payment</TH>
              <TH>Paid via</TH>
              <TH>Status</TH>
              <TH className="text-right">Actions</TH>
            </THead>
            <TBody>
              {filtered.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <Link
                      href={`/orders/${o.id}`}
                      className="font-medium text-espresso underline-offset-2 hover:underline"
                    >
                      {o.order_number}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap text-latte">
                    {formatDateTime(o.created_at)}
                  </TD>
                  <TD>
                    <Badge tone={TYPE_BADGES[o.order_type].tone}>
                      {TYPE_BADGES[o.order_type].label}
                    </Badge>
                  </TD>
                  <TD className="text-latte">{orderContext(o)}</TD>
                  <TD className="text-right font-medium text-espresso">
                    {formatPeso(o.total)}
                  </TD>
                  <TD>
                    <Badge tone={PAYMENT_BADGES[o.payment_status].tone}>
                      {PAYMENT_BADGES[o.payment_status].label}
                    </Badge>
                  </TD>
                  <TD className="text-latte">
                    {orderMethods(o)
                      .map((m) => m.name)
                      .join(", ") || "—"}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_BADGES[o.status].tone}>
                      {STATUS_BADGES[o.status].label}
                    </Badge>
                  </TD>
                  <TD className="text-right">
                    {(o.status === "open" || o.status === "held") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => setCancelling(o)}
                      >
                        Cancel
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {settling && (
        <SettleDialog
          tab={settling}
          balance={tabStats.get(settling.id)?.balance ?? 0}
          methods={methods}
          gcashQrImage={gcashQrImage}
          onClose={() => setSettling(null)}
        />
      )}
      {reopening && (
        <ReopenDialog tab={reopening} onClose={() => setReopening(null)} />
      )}
      {cancelling && (
        <CancelOrderDialog order={cancelling} onClose={() => setCancelling(null)} />
      )}
      {viewingTab && (
        <TabOrdersDialog
          tab={viewingTab}
          orders={orders.filter((o) => o.tab_id === viewingTab.id)}
          onClose={() => setViewingTab(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settle dialog
// ---------------------------------------------------------------------------

interface PaymentRowForm {
  method: string;
  amount: string;
  reference_no: string;
  tendered: string;
}

function SettleDialog({
  tab,
  balance,
  methods,
  gcashQrImage,
  onClose,
}: {
  tab: TabRow;
  balance: number;
  methods: PaymentMethod[];
  gcashQrImage: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PaymentRowForm[]>([
    {
      method: methods[0]?.code ?? "cash",
      amount: balance.toFixed(2),
      reference_no: "",
      tendered: "",
    },
  ]);
  const [closeTab, setCloseTab] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const methodOf = (code: string) => methods.find((m) => m.code === code);
  const sum = rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
  const canClose = Math.abs(sum - balance) < 0.005;

  function updateRow(i: number, patch: Partial<PaymentRowForm>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        method: methods[0]?.code ?? "cash",
        amount: Math.max(0, balance - sum).toFixed(2),
        reference_no: "",
        tendered: "",
      },
    ]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (sum <= 0) {
      setError("Enter at least one payment amount.");
      return;
    }
    if (sum - balance > 0.005) {
      setError("Payments exceed the tab balance.");
      return;
    }
    for (const r of rows) {
      const m = methodOf(r.method);
      const amount = Number(r.amount);
      if (!m) {
        setError("Pick a payment method for every row.");
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setError("Every payment row needs an amount greater than zero.");
        return;
      }
      if (m.requires_reference && r.reference_no.trim() === "") {
        setError(`${m.name} payments need a reference number.`);
        return;
      }
      if (m.kind === "cash" && r.tendered !== "" && Number(r.tendered) < amount) {
        setError("Tendered cash is less than the amount due.");
        return;
      }
    }

    setLoading(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("tab_settle", {
      p_tab: tab.id,
      p_payments: rows.map((r) => {
        const m = methodOf(r.method)!;
        return {
          method: r.method,
          amount: Number(r.amount),
          reference_no: r.reference_no.trim() || null,
          tendered:
            m.kind === "cash" && r.tendered !== "" ? Number(r.tendered) : null,
        };
      }),
      p_idempotency_key: crypto.randomUUID(),
      p_close: closeTab && canClose,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Settle ${tab.name}`}
      description={`Outstanding balance: ${formatPeso(balance)}`}
      className="max-w-xl"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="space-y-3">
          {rows.map((row, i) => {
            const m = methodOf(row.method);
            const amount = Number(row.amount) || 0;
            const tendered = row.tendered === "" ? null : Number(row.tendered);
            const change = tendered === null ? null : tendered - amount;
            return (
              <div key={i} className="rounded-xl border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Method">
                    <Select
                      value={row.method}
                      onChange={(e) => updateRow(i, { method: e.target.value })}
                    >
                      {methods.map((pm) => (
                        <option key={pm.code} value={pm.code}>
                          {pm.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Amount">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={row.amount}
                      onChange={(e) => updateRow(i, { amount: e.target.value })}
                    />
                  </Field>
                  {m?.requires_reference && (
                    <Field label="Reference no.">
                      <Input
                        required
                        value={row.reference_no}
                        onChange={(e) =>
                          updateRow(i, { reference_no: e.target.value })
                        }
                        placeholder="Transaction reference"
                      />
                    </Field>
                  )}
                  {m?.kind === "cash" && (
                    <Field label="Cash tendered">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.tendered}
                        onChange={(e) => updateRow(i, { tendered: e.target.value })}
                        placeholder="Optional"
                      />
                    </Field>
                  )}
                </div>
                {row.method === "gcash" && <GcashQr image={gcashQrImage} />}
                <div className="mt-2 flex items-center justify-between">
                  {m?.kind === "cash" && change !== null ? (
                    <p
                      className={
                        change < 0
                          ? "text-sm font-medium text-danger"
                          : "text-sm text-court-deep"
                      }
                    >
                      Change: {formatPeso(change)}
                    </p>
                  ) : (
                    <span />
                  )}
                  {rows.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => removeRow(i)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={addRow}>
            Add payment
          </Button>
          <p className="text-sm text-latte">
            Entered:{" "}
            <span
              className={
                sum - balance > 0.005
                  ? "font-medium text-danger"
                  : "font-medium text-espresso"
              }
            >
              {formatPeso(sum)}
            </span>{" "}
            of {formatPeso(balance)}
          </p>
        </div>

        <Switch
          checked={closeTab && canClose}
          onChange={setCloseTab}
          label="Close tab after payment"
          disabled={!canClose}
        />
        {!canClose && (
          <p className="text-xs text-latte">
            The tab can only be closed when payments cover the full balance.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Take payment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reopen dialog
// ---------------------------------------------------------------------------

function ReopenDialog({ tab, onClose }: { tab: TabRow; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("tab_reopen", {
      p_tab: tab.id,
      p_reason: reason,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reopen ${tab.name}`}
      description="The tab returns to the open list and can take new orders and payments."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Reason (recorded in audit log)">
          <Input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. closed by mistake"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Reopen tab
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cancel order dialog
// ---------------------------------------------------------------------------

function CancelOrderDialog({
  order,
  onClose,
}: {
  order: OrderListRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("order_cancel", {
      p_order: order.id,
      p_reason: reason,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cancel ${order.order_number}`}
      description="Cancelling removes this unposted order. Completed sales must be voided instead."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Reason (recorded in audit log)">
          <Input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. customer changed their mind"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Keep order
          </Button>
          <Button type="submit" variant="danger" loading={loading}>
            Cancel order
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tab orders dialog — every order rung up under a tab, with links to each
// order's own detail/receipt page (only the last 100 orders are loaded on
// this page, so a very old tab's earlier rounds may not all show here).
// ---------------------------------------------------------------------------

function TabOrdersDialog({
  tab,
  orders,
  onClose,
}: {
  tab: TabRow;
  orders: OrderListRow[];
  onClose: () => void;
}) {
  const sorted = [...orders].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const total = sorted.reduce((s, o) => s + Number(o.total), 0);
  const paid = sorted.reduce((s, o) => s + Number(o.amount_paid), 0);

  // Grouped by Manila calendar day — everything ordered on a given day
  // settles as one combined receipt, rather than one per order.
  const byDay = new Map<string, OrderListRow[]>();
  for (const o of sorted) {
    const key = manilaDateKey(o.created_at);
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(o);
  }
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Orders on ${tab.name}`}
      description={`${sorted.length} order${sorted.length === 1 ? "" : "s"} · ${formatPeso(total)} total · ${formatPeso(total - paid)} balance`}
      className="max-w-2xl"
    >
      <div className="space-y-5">
        {sorted.length === 0 ? (
          <EmptyState title="No orders yet" description="Nothing has been rung up on this tab." />
        ) : (
          days.map(([day, dayOrders]) => {
            const dayTotal = dayOrders.reduce((s, o) => s + Number(o.total), 0);
            return (
              <div key={day}>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-sm font-semibold text-espresso">
                    {new Intl.DateTimeFormat("en-PH", {
                      timeZone: "Asia/Manila",
                      dateStyle: "medium",
                    }).format(new Date(`${day}T12:00:00`))}
                    <span className="ml-2 font-normal text-latte">
                      {dayOrders.length} order{dayOrders.length === 1 ? "" : "s"} ·{" "}
                      {formatPeso(dayTotal)}
                    </span>
                  </p>
                  <Link
                    href={`/receipt/tab/${tab.id}/${day}`}
                    target="_blank"
                    className="text-sm font-medium text-court underline-offset-2 hover:underline"
                  >
                    Day receipt
                  </Link>
                </div>
                <Table>
                  <THead>
                    <TH>Order</TH>
                    <TH>Time</TH>
                    <TH className="text-right">Total</TH>
                    <TH>Status</TH>
                    <TH>Payment</TH>
                  </THead>
                  <TBody>
                    {dayOrders.map((o) => (
                      <TR key={o.id}>
                        <TD className="font-medium">
                          <Link
                            href={`/orders/${o.id}`}
                            className="text-espresso underline-offset-2 hover:underline"
                          >
                            {o.order_number}
                          </Link>
                        </TD>
                        <TD className="text-latte">{formatTime(o.created_at)}</TD>
                        <TD className="text-right text-espresso">{formatPeso(o.total)}</TD>
                        <TD>
                          <Badge tone={STATUS_BADGES[o.status].tone}>
                            {STATUS_BADGES[o.status].label}
                          </Badge>
                        </TD>
                        <TD>
                          <Badge tone={PAYMENT_BADGES[o.payment_status].tone}>
                            {PAYMENT_BADGES[o.payment_status].label}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            );
          })
        )}
        <div className="flex justify-end pt-1">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
