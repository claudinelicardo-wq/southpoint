"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { InventoryItem } from "@/lib/catalog-types";
import { formatDateTime, formatPeso, formatQty } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

// Mirrors public.stock_counts (0007_operations.sql).
export type CountStatus = "draft" | "submitted" | "posted" | "cancelled";

export interface StockCountRow {
  id: string;
  sc_number: string;
  status: CountStatus;
  notes: string | null;
  started_by: string;
  approved_by: string | null;
  created_at: string;
  posted_at: string | null;
}

type ItemLite = Pick<InventoryItem, "id" | "name" | "base_unit">;

// A line as fetched for the detail dialog, with the item's current cost joined
// so we can show peso variance.
interface CountLine {
  id: string;
  item_id: string;
  expected_qty: number;
  actual_qty: number | null;
  note: string | null;
  inventory_items: {
    name: string;
    base_unit: string;
    avg_cost: number | string | null;
    latest_cost: number | string | null;
  } | null;
}

const STATUS_BADGES: Record<CountStatus, { tone: "info" | "warning" | "success" | "neutral"; label: string }> = {
  draft: { tone: "info", label: "Draft" },
  submitted: { tone: "warning", label: "Awaiting approval" },
  posted: { tone: "success", label: "Posted" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

export function CountsManager({
  counts,
  profileNames,
  items,
  canCount,
  preview,
}: {
  counts: StockCountRow[];
  profileNames: Record<string, string>;
  items: ItemLite[];
  canCount: boolean;
  preview: boolean;
}) {
  const router = useRouter();
  const [startOpen, setStartOpen] = useState(false);
  const [openCount, setOpenCount] = useState<StockCountRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {preview && (
        <Alert tone="warning">Stock counts need a connected Supabase project.</Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {canCount && (
        <div className="flex justify-end">
          <Button onClick={() => setStartOpen(true)} disabled={preview}>
            Start count
          </Button>
        </div>
      )}

      {counts.length === 0 ? (
        <EmptyState
          title="No stock counts yet"
          description="Start a physical count to reconcile expected stock against what's actually on the shelf."
          action={
            canCount ? (
              <Button onClick={() => setStartOpen(true)} disabled={preview}>
                Start count
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TH>Number</TH>
            <TH>Started</TH>
            <TH>Status</TH>
            <TH>Started by</TH>
            <TH>Notes</TH>
            <TH className="text-right">Actions</TH>
          </THead>
          <TBody>
            {counts.map((c) => {
              const badge = STATUS_BADGES[c.status];
              return (
                <TR key={c.id}>
                  <TD className="font-medium whitespace-nowrap">{c.sc_number}</TD>
                  <TD className="text-latte whitespace-nowrap">{formatDateTime(c.created_at)}</TD>
                  <TD>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </TD>
                  <TD className="text-latte">{profileNames[c.started_by] ?? "—"}</TD>
                  <TD className="text-latte">{c.notes || "—"}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpenCount(c)}>
                      Open
                    </Button>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {startOpen && (
        <StartCountDialog
          items={items}
          onClose={() => setStartOpen(false)}
          onStarted={(id) => {
            setStartOpen(false);
            // Refresh the list, then open the new draft for count entry.
            router.refresh();
            setOpenCount({
              id,
              sc_number: "…",
              status: "draft",
              notes: null,
              started_by: "",
              approved_by: null,
              created_at: new Date().toISOString(),
              posted_at: null,
            });
          }}
        />
      )}

      {openCount && (
        <CountDetailDialog
          count={openCount}
          onClose={() => setOpenCount(null)}
          onChanged={() => {
            setOpenCount(null);
            router.refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function StartCountDialog({
  items,
  onClose,
  onStarted,
}: {
  items: ItemLite[];
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const [scope, setScope] = useState<"full" | "partial">("full");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (scope === "partial" && selected.size === 0) {
      setError("Select at least one item for a partial count.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("count_start", {
      p_item_ids: scope === "partial" ? Array.from(selected) : null,
      p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onStarted(data as string);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Start a stock count"
      description="A snapshot of expected stock is captured now; you enter actual quantities next."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Scope">
          <Select value={scope} onChange={(e) => setScope(e.target.value as "full" | "partial")}>
            <option value="full">Full count (all items)</option>
            <option value="partial">Partial count (choose items)</option>
          </Select>
        </Field>

        {scope === "partial" && (
          <div className="max-h-56 overflow-y-auto rounded-xl border border-line p-2">
            {items.length === 0 ? (
              <p className="p-2 text-sm text-latte">No inventory items.</p>
            ) : (
              items.map((i) => (
                <label
                  key={i.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sand"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i.id)}
                    onChange={() => toggle(i.id)}
                  />
                  <span className="text-espresso">{i.name}</span>
                  <span className="text-xs text-latte">({i.base_unit})</span>
                </label>
              ))
            )}
          </div>
        )}

        <Field label="Notes (optional)">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. end-of-month full count"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Start count
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function costOf(line: CountLine): number {
  const inv = line.inventory_items;
  if (!inv) return 0;
  const avg = Number(inv.avg_cost ?? 0);
  return avg > 0 ? avg : Number(inv.latest_cost ?? 0);
}

function CountDetailDialog({
  count,
  onClose,
  onChanged,
  onError,
}: {
  count: StockCountRow;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<CountLine[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const status: CountStatus = count.status;
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [loaded, setLoaded] = useState(false);

  const editable = status === "draft";

  // Load lines when the dialog opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data, error: dbError } = await supabase
        .from("stock_count_items")
        .select(
          "id, item_id, expected_qty, actual_qty, note, inventory_items(name, base_unit, avg_cost, latest_cost)",
        )
        .eq("count_id", count.id);
      if (cancelled) return;
      if (dbError) {
        setError(dbError.message);
        setLoaded(true);
        return;
      }
      const rows = (data as unknown as CountLine[] | null) ?? [];
      rows.sort((a, b) =>
        (a.inventory_items?.name ?? "").localeCompare(b.inventory_items?.name ?? ""),
      );
      setLines(rows);
      setDrafts(
        Object.fromEntries(
          rows.map((r) => [r.id, r.actual_qty !== null ? String(r.actual_qty) : ""]),
        ),
      );
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [count.id]);

  async function saveDraft(): Promise<boolean> {
    if (!lines) return false;
    const supabase = createClient();
    for (const line of lines) {
      const raw = drafts[line.id];
      const actual = raw === "" || raw === undefined ? null : Number(raw);
      if (actual !== null && !Number.isFinite(actual)) {
        setError(`Invalid quantity for ${line.inventory_items?.name ?? "an item"}.`);
        return false;
      }
      const note = line.note;
      const { error: dbError } = await supabase
        .from("stock_count_items")
        .update({ actual_qty: actual, note })
        .eq("id", line.id);
      if (dbError) {
        setError(dbError.message);
        return false;
      }
    }
    return true;
  }

  async function onSaveDraft() {
    setBusy(true);
    setError(null);
    const ok = await saveDraft();
    setBusy(false);
    if (ok) {
      onChanged();
    }
  }

  async function onSubmit() {
    setBusy(true);
    setError(null);
    const ok = await saveDraft();
    if (!ok) {
      setBusy(false);
      return;
    }
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("count_submit", { p_count: count.id });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onChanged();
  }

  async function resolve(approve: boolean) {
    if (!approve && rejectReason.trim() === "") {
      setError("A reason is required to reject a count.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("count_post", {
      p_count: count.id,
      p_approve: approve,
      p_reason: rejectReason.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      onError(null);
      setError(rpcError.message);
      return;
    }
    onChanged();
    router.refresh();
  }

  const totals = useMemo(() => {
    if (!lines) return { qtyLines: 0, peso: 0 };
    let peso = 0;
    let qtyLines = 0;
    for (const line of lines) {
      const raw = editable ? drafts[line.id] : line.actual_qty;
      if (raw === "" || raw === undefined || raw === null) continue;
      const actual = Number(raw);
      const variance = actual - Number(line.expected_qty);
      if (variance !== 0) {
        qtyLines += 1;
        peso += variance * costOf(line);
      }
    }
    return { qtyLines, peso };
  }, [lines, drafts, editable]);

  const badge = STATUS_BADGES[status];

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Count ${count.sc_number === "…" ? "" : count.sc_number}`}
      description="Actual vs expected. Approved variances post to the movement ledger."
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {totals.qtyLines > 0 && (
            <p className="text-sm text-roast">
              {totals.qtyLines} line{totals.qtyLines === 1 ? "" : "s"} with variance ·{" "}
              <span
                className={
                  totals.peso < 0 ? "font-medium text-danger" : "font-medium text-espresso"
                }
              >
                {formatPeso(totals.peso)}
              </span>
            </p>
          )}
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        {!loaded ? (
          <p className="py-6 text-center text-sm text-latte">Loading lines…</p>
        ) : !lines || lines.length === 0 ? (
          <EmptyState title="No lines" description="This count has no items." />
        ) : (
          <div className="max-h-[50vh] overflow-y-auto">
            <Table>
              <THead>
                <TH>Item</TH>
                <TH className="text-right">Expected</TH>
                <TH className="text-right">Actual</TH>
                <TH className="text-right">Variance</TH>
                <TH className="text-right">₱ variance</TH>
              </THead>
              <TBody>
                {lines.map((line) => {
                  const raw = editable ? drafts[line.id] : line.actual_qty;
                  const hasActual = raw !== "" && raw !== undefined && raw !== null;
                  const actual = hasActual ? Number(raw) : null;
                  const variance = actual !== null ? actual - Number(line.expected_qty) : null;
                  const unit = line.inventory_items?.base_unit ?? "";
                  return (
                    <TR key={line.id}>
                      <TD className="text-espresso">
                        {line.inventory_items?.name ?? "Item"}
                        <span className="ml-1 text-xs text-latte">({unit})</span>
                      </TD>
                      <TD className="text-right text-latte">
                        {formatQty(line.expected_qty)}
                      </TD>
                      <TD className="text-right">
                        {editable ? (
                          <Input
                            type="number"
                            step="any"
                            value={drafts[line.id] ?? ""}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [line.id]: e.target.value }))
                            }
                            className="w-24 text-right"
                          />
                        ) : line.actual_qty !== null ? (
                          formatQty(line.actual_qty)
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD
                        className={
                          variance === null
                            ? "text-right text-latte"
                            : variance < 0
                              ? "text-right font-medium text-danger"
                              : variance > 0
                                ? "text-right font-medium text-espresso"
                                : "text-right text-latte"
                        }
                      >
                        {variance === null
                          ? "—"
                          : `${variance > 0 ? "+" : ""}${formatQty(variance)}`}
                      </TD>
                      <TD className="text-right text-latte">
                        {variance === null || variance === 0
                          ? "—"
                          : formatPeso(variance * costOf(line))}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}

        {status === "submitted" && (
          <Field label="Rejection reason (required to reject)">
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Only needed if rejecting"
            />
          </Field>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {editable && (
            <>
              <Button variant="outline" onClick={onSaveDraft} loading={busy}>
                Save draft
              </Button>
              <Button onClick={onSubmit} loading={busy}>
                Submit for approval
              </Button>
            </>
          )}
          {status === "submitted" && (
            <>
              <Button
                variant="ghost"
                className="text-danger"
                onClick={() => resolve(false)}
                loading={busy}
              >
                Reject
              </Button>
              <Button onClick={() => resolve(true)} loading={busy}>
                Approve &amp; post
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
