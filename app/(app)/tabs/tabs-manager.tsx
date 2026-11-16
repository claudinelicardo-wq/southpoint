"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatPeso, formatTime, manilaDateKey } from "@/lib/format";
import {
  formatYMDWithWeekday,
  periodLabel,
  PERIOD_VIEWS,
  stepPeriod,
  type PeriodView,
} from "@/lib/periods";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SettleDialog, type PaymentMethod, type TabRow } from "../orders/orders-manager";

export type TabsView = PeriodView | "unpaid";

export interface TabInfo {
  id: string;
  name: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
}

export interface TabHistoryOrder {
  id: string;
  order_number: string;
  tab_id: string;
  total: number;
  amount_paid: number;
  payment_status: "unpaid" | "partial" | "paid";
  created_at: string;
}

const PAYMENT_BADGES = {
  paid: { tone: "success", label: "Paid" },
  partial: { tone: "warning", label: "Partial" },
  unpaid: { tone: "danger", label: "Unpaid" },
} as const;

function href(view: TabsView, date?: string): string {
  const q = new URLSearchParams({ view });
  if (date) q.set("date", date);
  return `/tabs?${q.toString()}`;
}

export function TabsManager({
  view,
  anchor,
  today,
  orders,
  balances,
  tabs,
  methods,
  gcashQrImage,
  canSettle,
  preview,
}: {
  view: TabsView;
  anchor: string;
  today: string;
  orders: TabHistoryOrder[];
  balances: Record<string, number>;
  tabs: TabInfo[];
  methods: PaymentMethod[];
  gcashQrImage: string | null;
  canSettle: boolean;
  preview: boolean;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [settling, setSettling] = useState<TabRow | null>(null);

  const tabById = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);

  const groups = useMemo(() => {
    const byTab = new Map<string, TabHistoryOrder[]>();
    for (const o of orders) {
      (byTab.get(o.tab_id) ?? byTab.set(o.tab_id, []).get(o.tab_id)!).push(o);
    }
    const q = search.trim().toLowerCase();
    return [...byTab.entries()]
      .map(([tabId, list]) => {
        const total = list.reduce((s, o) => s + Number(o.total), 0);
        const paid = list.reduce((s, o) => s + Number(o.amount_paid), 0);
        return {
          tab: tabById.get(tabId),
          tabId,
          orders: list,
          total,
          unpaid: Math.round((total - paid) * 100) / 100,
          balance: balances[tabId] ?? 0,
          lastAt: list[list.length - 1]?.created_at ?? "",
        };
      })
      .filter((g) => !q || (g.tab?.name ?? "").toLowerCase().includes(q))
      .sort((a, b) => b.unpaid - a.unpaid || b.lastAt.localeCompare(a.lastAt));
  }, [orders, tabById, balances, search]);

  const totals = useMemo(() => {
    const charged = groups.reduce((s, g) => s + g.total, 0);
    const unpaid = groups.reduce((s, g) => s + g.unpaid, 0);
    return { charged, unpaid, paid: charged - unpaid, tabs: groups.length };
  }, [groups]);

  const allTimeUnpaid = Object.values(balances).reduce((s, v) => s + v, 0);
  const unpaidTabCount = Object.values(balances).filter((v) => v > 0.004).length;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const periodView = view === "unpaid" ? null : view;

  return (
    <div className="space-y-6">
      {preview && <Alert tone="warning">Tabs need a connected Supabase project.</Alert>}

      {allTimeUnpaid > 0.004 && view !== "unpaid" && (
        <Alert tone="warning">
          {unpaidTabCount} tab{unpaidTabCount === 1 ? " has" : "s have"} unpaid bills totalling{" "}
          <span className="font-semibold">{formatPeso(allTimeUnpaid)}</span> across all dates.{" "}
          <Link href={href("unpaid")} className="font-semibold underline underline-offset-2">
            See all unpaid
          </Link>
        </Alert>
      )}

      {/* View switcher + period navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Tab history view">
          {PERIOD_VIEWS.map((v) => (
            <ViewLink key={v.key} active={view === v.key} href={href(v.key, anchor)}>
              {v.label}
            </ViewLink>
          ))}
          <ViewLink active={view === "unpaid"} href={href("unpaid")}>
            All unpaid
            {unpaidTabCount > 0 && (
              <span className="ml-1.5 rounded-full bg-danger px-1.5 text-xs text-white">
                {unpaidTabCount}
              </span>
            )}
          </ViewLink>
        </div>
        <Input
          className="h-9 w-full sm:w-56"
          placeholder="Search tab name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search tabs"
        />
      </div>

      {periodView && (
        <div className="flex items-center justify-between gap-2 rounded-(--radius-card) border border-line bg-paper px-3 py-2 shadow-(--shadow-card)">
          <Link
            href={href(periodView, stepPeriod(periodView, anchor, -1))}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-roast hover:bg-sand"
            aria-label="Previous period"
          >
            ‹ Prev
          </Link>
          <div className="text-center">
            <p className="font-display font-semibold text-espresso">
              {periodLabel(periodView, anchor)}
            </p>
            {anchor !== today && (
              <Link
                href={href(periodView, today)}
                className="text-xs font-medium text-court underline-offset-2 hover:underline"
              >
                Back to today
              </Link>
            )}
          </div>
          <Link
            href={href(periodView, stepPeriod(periodView, anchor, 1))}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-roast hover:bg-sand"
            aria-label="Next period"
          >
            Next ›
          </Link>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tabs" value={String(totals.tabs)} />
        <Stat label={view === "unpaid" ? "Billed (unpaid orders)" : "Billed"} value={formatPeso(totals.charged)} />
        <Stat label="Paid" value={formatPeso(totals.paid)} />
        <Stat
          label="Unpaid"
          value={formatPeso(totals.unpaid)}
          tone={totals.unpaid > 0.004 ? "danger" : undefined}
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title={view === "unpaid" ? "No unpaid tab bills" : "No tab orders in this period"}
          description={
            view === "unpaid"
              ? "Every tab order has been fully paid."
              : "Use Prev / Next to look at other dates, or switch to Weekly or Monthly."
          }
        />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const open = expanded.has(g.tabId);
            const name = g.tab?.name ?? "Unknown tab";
            const byDay = new Map<string, TabHistoryOrder[]>();
            for (const o of g.orders) {
              const key = manilaDateKey(o.created_at);
              (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(o);
            }
            const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
            return (
              <Card key={g.tabId}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggle(g.tabId)}
                      className="min-w-0 flex-1 text-left"
                      aria-expanded={open}
                    >
                      <p className="flex items-center gap-2 font-medium text-espresso">
                        <span aria-hidden className="text-latte">{open ? "▾" : "▸"}</span>
                        {name}
                        <Badge tone={g.tab?.status === "open" ? "info" : "neutral"}>
                          {g.tab?.status === "open" ? "Open" : "Closed"}
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-latte">
                        {g.orders.length} order{g.orders.length === 1 ? "" : "s"} ·{" "}
                        {days.length} day{days.length === 1 ? "" : "s"} · {formatPeso(g.total)} billed
                      </p>
                    </button>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p
                          className={cn(
                            "text-lg font-semibold",
                            g.unpaid > 0.004 ? "text-danger" : "text-court-deep",
                          )}
                        >
                          {g.unpaid > 0.004 ? formatPeso(g.unpaid) : "Paid"}
                        </p>
                        {g.unpaid > 0.004 && (
                          <p className="text-xs text-latte">unpaid{periodView ? " this period" : ""}</p>
                        )}
                        {periodView && g.balance - g.unpaid > 0.004 && (
                          <p className="text-xs font-medium text-danger">
                            + {formatPeso(g.balance - g.unpaid)} from other dates
                          </p>
                        )}
                      </div>
                      {canSettle && g.balance > 0.004 && g.tab?.status === "open" && (
                        <Button size="sm" onClick={() => g.tab && setSettling(g.tab)}>
                          Settle {formatPeso(g.balance)}
                        </Button>
                      )}
                    </div>
                  </div>

                  {open && (
                    <div className="mt-4 space-y-4">
                      {days.map(([day, dayOrders]) => {
                        const dayTotal = dayOrders.reduce((s, o) => s + Number(o.total), 0);
                        const dayUnpaid = dayOrders.reduce(
                          (s, o) => s + Number(o.total) - Number(o.amount_paid),
                          0,
                        );
                        return (
                          <div key={day}>
                            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-espresso">
                                {formatYMDWithWeekday(day)}
                                <span className="ml-2 font-normal text-latte">
                                  {formatPeso(dayTotal)}
                                  {dayUnpaid > 0.004 && (
                                    <span className="text-danger"> · {formatPeso(dayUnpaid)} unpaid</span>
                                  )}
                                </span>
                              </p>
                              <Link
                                href={`/receipt/tab/${g.tabId}/${day}`}
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
                                <TH className="text-right">Unpaid</TH>
                                <TH>Payment</TH>
                              </THead>
                              <TBody>
                                {dayOrders.map((o) => {
                                  const due = Number(o.total) - Number(o.amount_paid);
                                  return (
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
                                      <TD className={cn("text-right", due > 0.004 ? "text-danger" : "text-latte")}>
                                        {due > 0.004 ? formatPeso(due) : "—"}
                                      </TD>
                                      <TD>
                                        <Badge tone={PAYMENT_BADGES[o.payment_status].tone}>
                                          {PAYMENT_BADGES[o.payment_status].label}
                                        </Badge>
                                      </TD>
                                    </TR>
                                  );
                                })}
                              </TBody>
                            </Table>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {settling && (
        <SettleDialog
          tab={settling}
          balance={balances[settling.id] ?? 0}
          methods={methods}
          gcashQrImage={gcashQrImage}
          onClose={() => setSettling(null)}
        />
      )}
    </div>
  );
}

function ViewLink({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={cn(
        "inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium transition-colors",
        active ? "bg-espresso text-paper" : "bg-sand text-roast hover:bg-line",
      )}
    >
      {children}
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-(--radius-card) border border-line bg-paper px-4 py-3 shadow-(--shadow-card)">
      <p className="text-xs text-latte">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold", tone === "danger" ? "text-danger" : "text-espresso")}>
        {value}
      </p>
    </div>
  );
}
