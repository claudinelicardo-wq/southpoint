"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { formatQty, formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export interface KDSItem {
  id: string;
  product_name: string;
  variant_name: string | null;
  qty: number;
  station: "bar" | "kitchen" | "none";
  prep_status: "new" | "accepted" | "preparing" | "ready" | "served" | "cancelled";
  prep_status_at: string;
  notes: string | null;
  order_item_modifiers: { option_name: string; group_name: string }[];
}

export interface KDSOrder {
  id: string;
  order_number: string;
  order_type: string;
  courtside_label: string | null;
  notes: string | null;
  completed_at: string;
  tabs: { name: string } | null;
  customers: { full_name: string } | null;
  order_items: KDSItem[];
}

const NEXT_STATUS: Record<string, KDSItem["prep_status"] | null> = {
  new: "preparing",
  accepted: "preparing",
  preparing: "ready",
  ready: "served",
  served: null,
};

const STATUS_LABEL: Record<KDSItem["prep_status"], string> = {
  new: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled",
};

const ADVANCE_LABEL: Record<string, string> = {
  new: "Start",
  accepted: "Start",
  preparing: "Ready",
  ready: "Serve",
};

export function KDSBoard({
  initialOrders,
  canUpdate,
  preview,
}: {
  initialOrders: KDSOrder[];
  canUpdate: boolean;
  preview: boolean;
}) {
  const router = useRouter();
  const [station, setStation] = useState<"all" | "bar" | "kitchen">("all");
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  // Local copy so a click can update the board instantly instead of waiting
  // on the DB write + a full router.refresh() round trip. Resynced whenever
  // a refresh actually lands, using React's reset-during-render pattern
  // (see react.dev/learn/you-might-not-need-an-effect) rather than an effect.
  const [orders, setOrders] = useState(initialOrders);
  const [syncedFrom, setSyncedFrom] = useState(initialOrders);
  if (initialOrders !== syncedFrom) {
    setSyncedFrom(initialOrders);
    setOrders(initialOrders);
  }

  // Elapsed-time ticker.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Realtime + polling fallback.
  useEffect(() => {
    if (preview || !isSupabaseConfigured) return;
    const supabase = createClient();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timeout) return;
      timeout = setTimeout(() => {
        timeout = null;
        router.refresh();
      }, 400);
    };
    const channel = supabase
      .channel("kds")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
      .subscribe();
    const poll = setInterval(() => router.refresh(), 20_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      if (timeout) clearTimeout(timeout);
    };
  }, [preview, router]);

  // Tickets: one per order per station, only prepared items still in flight.
  const tickets = useMemo(() => {
    const out: { order: KDSOrder; station: "bar" | "kitchen"; items: KDSItem[] }[] = [];
    for (const order of orders) {
      for (const st of ["bar", "kitchen"] as const) {
        if (station !== "all" && station !== st) continue;
        const items = order.order_items.filter(
          (i) => i.station === st && !["served", "cancelled"].includes(i.prep_status),
        );
        if (items.length > 0) out.push({ order, station: st, items });
      }
    }
    return out;
  }, [orders, station]);

  async function setStatus(itemIds: string[], status: KDSItem["prep_status"]) {
    setError(null);
    const idSet = new Set(itemIds);
    const statusAt = new Date().toISOString();
    // Optimistic: reflect the change immediately, reconcile with the server
    // copy once router.refresh() lands (or revert it if the write fails).
    setOrders((prev) =>
      prev.map((order) => ({
        ...order,
        order_items: order.order_items.map((item) =>
          idSet.has(item.id) ? { ...item, prep_status: status, prep_status_at: statusAt } : item,
        ),
      })),
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("order_items")
      .update({ prep_status: status, prep_status_at: statusAt })
      .in("id", itemIds);
    if (error) {
      setError(error.message);
      setOrders(initialOrders);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-espresso">
          Kitchen / Bar
        </h1>
        <div className="flex gap-1 rounded-xl bg-sand p-1">
          {(["all", "bar", "kitchen"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStation(s)}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-medium capitalize",
                station === s ? "bg-paper text-espresso shadow-sm" : "text-latte",
              )}
            >
              {s === "all" ? "All stations" : s}
            </button>
          ))}
        </div>
      </div>

      {preview && (
        <Alert tone="warning" className="mb-4">
          The kitchen display needs a connected Supabase project.
        </Alert>
      )}
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {tickets.length === 0 ? (
        <EmptyState
          title="All caught up"
          description="New preparation tickets appear here the moment a sale posts, and update in real time."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {tickets.map(({ order, station: st, items }) => {
            const oldest = new Date(order.completed_at).getTime();
            const elapsedMin = Math.max(0, Math.floor((now - oldest) / 60_000));
            const allReady = items.every((i) => i.prep_status === "ready");
            const context =
              order.tabs?.name ??
              order.courtside_label ??
              order.customers?.full_name ??
              null;
            return (
              <div
                key={`${order.id}-${st}`}
                className={cn(
                  "flex flex-col rounded-(--radius-card) border bg-paper shadow-(--shadow-card)",
                  elapsedMin >= 15
                    ? "border-danger"
                    : elapsedMin >= 8
                      ? "border-amber"
                      : "border-line",
                )}
              >
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <div>
                    <p className="font-semibold text-espresso">{order.order_number}</p>
                    <p className="text-xs text-latte">
                      {formatTime(order.completed_at)}
                      {context ? ` · ${context}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={st === "bar" ? "info" : "accent"}>{st}</Badge>
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        elapsedMin >= 15
                          ? "text-danger"
                          : elapsedMin >= 8
                            ? "text-amber"
                            : "text-latte",
                      )}
                    >
                      {elapsedMin}m
                    </span>
                  </div>
                </div>
                <ul className="flex-1 divide-y divide-line/60">
                  {items.map((i) => (
                    <li key={i.id} className="px-4 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-espresso">
                            {formatQty(i.qty)} × {i.product_name}
                            {i.variant_name && (
                              <span className="text-latte"> · {i.variant_name}</span>
                            )}
                          </p>
                          {i.order_item_modifiers.length > 0 && (
                            <p className="text-xs text-roast">
                              {i.order_item_modifiers.map((m) => m.option_name).join(", ")}
                            </p>
                          )}
                          {i.notes && (
                            <p className="text-xs font-medium text-clay">“{i.notes}”</p>
                          )}
                        </div>
                        <Badge
                          tone={
                            i.prep_status === "ready"
                              ? "success"
                              : i.prep_status === "preparing"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {STATUS_LABEL[i.prep_status]}
                        </Badge>
                      </div>
                      {canUpdate && NEXT_STATUS[i.prep_status] && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-1.5"
                          onClick={() => setStatus([i.id], NEXT_STATUS[i.prep_status]!)}
                        >
                          {ADVANCE_LABEL[i.prep_status]}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {order.notes && (
                  <p className="border-t border-line px-4 py-2 text-xs italic text-latte">
                    Order note: {order.notes}
                  </p>
                )}
                {canUpdate && (
                  <div className="border-t border-line p-2.5">
                    <Button
                      className="w-full"
                      variant={allReady ? "primary" : "secondary"}
                      onClick={() =>
                        setStatus(
                          items.map((i) => i.id),
                          allReady ? "served" : "ready",
                        )
                      }
                    >
                      {allReady ? "Mark ticket served" : "Mark all ready"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
