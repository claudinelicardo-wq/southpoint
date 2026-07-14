"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatDateTime, formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Row shapes (mirrors supabase/migrations/0003_pos.sql + 0007_operations.sql)
// ---------------------------------------------------------------------------

export interface ShiftRow {
  id: string;
  cashier_id: string;
  terminal: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  variance: number | null;
  variance_reason: string | null;
  totals_snapshot: Record<string, unknown> | null;
  notes: string | null;
}

export type ClosedShiftRow = ShiftRow & {
  profiles: { full_name: string } | null;
};

export interface CashMovementRow {
  id: string;
  shift_id: string;
  kind: "paid_in" | "paid_out";
  amount: number;
  reason: string;
  notes: string | null;
  created_at: string;
}

interface ShiftTotals {
  by_method?: Record<string, number>;
  orders?: number;
  voids?: number;
  refunds?: number;
  discounts?: number;
  gross_sales?: number;
  paid_in?: number;
  paid_out?: number;
}

interface CloseResult {
  shift_id: string;
  expected_cash: number;
  actual_cash: number;
  variance: number;
  totals: ShiftTotals;
}

function varianceClass(v: number): string {
  if (v < 0) return "text-danger";
  if (v > 0) return "text-amber";
  return "text-court-deep";
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export function ShiftsManager({
  openShift,
  movements,
  closedShifts,
  canOwn,
  canViewExpected,
  showExpectedSetting,
  preview,
}: {
  openShift: ShiftRow | null;
  movements: CashMovementRow[];
  closedShifts: ClosedShiftRow[];
  canOwn: boolean;
  canViewExpected: boolean;
  showExpectedSetting: boolean;
  preview: boolean;
}) {
  const router = useRouter();
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);

  // Open-shift form
  const [openCash, setOpenCash] = useState("0");
  const [terminal, setTerminal] = useState("Main");
  const [openError, setOpenError] = useState<string | null>(null);
  const [openBusy, setOpenBusy] = useState(false);

  // Lazily fetched expected cash for the open shift
  const [expected, setExpected] = useState<number | null>(null);
  const [expectedError, setExpectedError] = useState<string | null>(null);
  const [expectedBusy, setExpectedBusy] = useState(false);

  // Paid in / paid out dialog
  const [moveKind, setMoveKind] = useState<"paid_in" | "paid_out" | null>(null);
  const [move, setMove] = useState({ amount: "", reason: "", notes: "" });
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  // Close-shift dialog
  const [closeOpen, setCloseOpen] = useState(false);
  const [close, setClose] = useState({ actual: "", reason: "", notes: "" });
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);

  async function openShiftSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOpenBusy(true);
    setOpenError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("shift_open", {
      p_opening_cash: Number(openCash),
      p_terminal: terminal.trim() || "Main",
    });
    setOpenBusy(false);
    if (error) {
      setOpenError(error.message);
      return;
    }
    setCloseResult(null);
    router.refresh();
  }

  async function loadExpected() {
    if (!openShift) return;
    setExpectedBusy(true);
    setExpectedError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("shift_expected_cash", {
      p_shift: openShift.id,
    });
    setExpectedBusy(false);
    // The RPC refuses when the blind-count rule applies — show its message.
    if (error) {
      setExpectedError(error.message);
      return;
    }
    setExpected(Number(data));
  }

  async function submitMove(e: React.FormEvent) {
    e.preventDefault();
    if (!moveKind) return;
    setMoveBusy(true);
    setMoveError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("cash_move", {
      p_kind: moveKind,
      p_amount: Number(move.amount),
      p_reason: move.reason.trim(),
      p_notes: move.notes.trim() || null,
    });
    setMoveBusy(false);
    if (error) {
      setMoveError(error.message);
      return;
    }
    setMoveKind(null);
    setExpected(null); // stale after a drawer movement
    router.refresh();
  }

  async function submitClose(e: React.FormEvent) {
    e.preventDefault();
    setCloseBusy(true);
    setCloseError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("shift_close", {
      p_actual_cash: Number(close.actual),
      p_variance_reason: close.reason.trim() || null,
      p_notes: close.notes.trim() || null,
    });
    setCloseBusy(false);
    if (error) {
      setCloseError(error.message);
      return;
    }
    setCloseOpen(false);
    setClose({ actual: "", reason: "", notes: "" });
    setExpected(null);
    setCloseResult(data as CloseResult);
    router.refresh();
  }

  const showExpectedButton = canViewExpected || showExpectedSetting;

  return (
    <div className="space-y-6">
      {/* -------------------------------------------- close result (printable) */}
      {closeResult && (
        <section>
          <Card>
            <CardHeader
              title="Shift report"
              description="Drawer reconciliation for the shift you just closed."
              actions={
                <div className="no-print flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    Print shift report
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setCloseResult(null)}>
                    Dismiss
                  </Button>
                </div>
              }
            />
            <CardBody>
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Expected cash" value={formatPeso(closeResult.expected_cash)} />
                <Stat label="Actual cash (counted)" value={formatPeso(closeResult.actual_cash)} />
                <Stat
                  label="Variance"
                  value={formatPeso(closeResult.variance)}
                  className={varianceClass(closeResult.variance)}
                />
              </div>
              <div className="mt-5 grid gap-6 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-roast">
                    Payments by method
                  </h3>
                  {Object.keys(closeResult.totals.by_method ?? {}).length === 0 ? (
                    <p className="text-sm text-latte">No payments recorded.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {Object.entries(closeResult.totals.by_method ?? {}).map(
                        ([method, amount]) => (
                          <li key={method} className="flex justify-between">
                            <span className="text-roast">{method}</span>
                            <span className="font-medium text-espresso">
                              {formatPeso(amount)}
                            </span>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-roast">Activity</h3>
                  <ul className="space-y-1 text-sm">
                    <SummaryRow label="Gross sales" value={formatPeso(closeResult.totals.gross_sales ?? 0)} />
                    <SummaryRow label="Completed orders" value={String(closeResult.totals.orders ?? 0)} />
                    <SummaryRow label="Voids" value={String(closeResult.totals.voids ?? 0)} />
                    <SummaryRow label="Refunds" value={formatPeso(closeResult.totals.refunds ?? 0)} />
                    <SummaryRow label="Discounts" value={formatPeso(closeResult.totals.discounts ?? 0)} />
                    <SummaryRow label="Paid in" value={formatPeso(closeResult.totals.paid_in ?? 0)} />
                    <SummaryRow label="Paid out" value={formatPeso(closeResult.totals.paid_out ?? 0)} />
                  </ul>
                </div>
              </div>
            </CardBody>
          </Card>
        </section>
      )}

      {/* Everything below is hidden when printing the shift report. */}
      <div className={cn("space-y-6", closeResult && "no-print")}>
        {preview && (
          <Alert tone="warning">Shifts need a connected Supabase project.</Alert>
        )}

        {/* -------------------------------------------- current shift */}
        {canOwn && !openShift && (
          <Card>
            <CardHeader
              title="Open shift"
              description="Count the drawer before starting."
            />
            <CardBody>
              <form onSubmit={openShiftSubmit} className="max-w-sm space-y-4">
                {openError && <Alert tone="danger">{openError}</Alert>}
                <Field label="Opening cash (₱)">
                  <Input
                    type="number"
                    min="0"
                    step="0.25"
                    required
                    value={openCash}
                    onChange={(e) => setOpenCash(e.target.value)}
                  />
                </Field>
                <Field label="Terminal / drawer">
                  <Input
                    value={terminal}
                    onChange={(e) => setTerminal(e.target.value)}
                  />
                </Field>
                <Button type="submit" loading={openBusy} disabled={preview}>
                  Open shift
                </Button>
              </form>
            </CardBody>
          </Card>
        )}

        {openShift && (
          <Card>
            <CardHeader
              title="Current shift"
              description={`Opened ${formatDateTime(openShift.opened_at)} · Terminal ${openShift.terminal}`}
              actions={<Badge tone="success">Open</Badge>}
            />
            <CardBody className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Opening cash" value={formatPeso(openShift.opening_cash)} />
                <Stat
                  label="Paid in"
                  value={formatPeso(
                    movements
                      .filter((m) => m.kind === "paid_in")
                      .reduce((s, m) => s + Number(m.amount), 0),
                  )}
                />
                <Stat
                  label="Paid out"
                  value={formatPeso(
                    movements
                      .filter((m) => m.kind === "paid_out")
                      .reduce((s, m) => s + Number(m.amount), 0),
                  )}
                />
              </div>

              {showExpectedButton && (
                <div className="space-y-2">
                  {expected === null ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadExpected}
                      loading={expectedBusy}
                    >
                      Show expected cash
                    </Button>
                  ) : (
                    <Stat label="Expected cash in drawer" value={formatPeso(expected)} />
                  )}
                  {expectedError && <Alert tone="warning">{expectedError}</Alert>}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setMove({ amount: "", reason: "", notes: "" });
                    setMoveError(null);
                    setMoveKind("paid_in");
                  }}
                >
                  Paid in
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMove({ amount: "", reason: "", notes: "" });
                    setMoveError(null);
                    setMoveKind("paid_out");
                  }}
                >
                  Paid out
                </Button>
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    setClose({ actual: "", reason: "", notes: "" });
                    setCloseError(null);
                    setCloseOpen(true);
                  }}
                >
                  Close shift
                </Button>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-roast">Cash movements</h3>
                {movements.length === 0 ? (
                  <p className="text-sm text-latte">
                    No paid-ins or paid-outs on this shift yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-line/60 text-sm">
                    {movements.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 py-2">
                        <Badge tone={m.kind === "paid_in" ? "success" : "warning"}>
                          {m.kind === "paid_in" ? "Paid in" : "Paid out"}
                        </Badge>
                        <span
                          className={cn(
                            "font-medium",
                            m.kind === "paid_in" ? "text-court-deep" : "text-danger",
                          )}
                        >
                          {m.kind === "paid_in" ? "+" : "−"}
                          {formatPeso(m.amount)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-roast">
                          {m.reason}
                          {m.notes && <span className="text-latte"> · {m.notes}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-latte">
                          {formatDateTime(m.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {/* -------------------------------------------- closed shifts */}
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-espresso">
            Recent closed shifts
          </h2>
          {closedShifts.length === 0 ? (
            <EmptyState
              title="No closed shifts yet"
              description="Closed shifts appear here with their reconciliation results."
            />
          ) : (
            <Table>
              <THead>
                <TH>Cashier</TH>
                <TH>Opened</TH>
                <TH>Closed</TH>
                <TH>Expected</TH>
                <TH>Actual</TH>
                <TH>Variance</TH>
                <TH>Reason</TH>
              </THead>
              <TBody>
                {closedShifts.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium">{s.profiles?.full_name ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-latte">
                      {formatDateTime(s.opened_at)}
                    </TD>
                    <TD className="whitespace-nowrap text-latte">
                      {s.closed_at ? formatDateTime(s.closed_at) : "—"}
                    </TD>
                    <TD className="text-latte">
                      {s.expected_cash !== null ? formatPeso(s.expected_cash) : "—"}
                    </TD>
                    <TD className="text-latte">
                      {s.actual_cash !== null ? formatPeso(s.actual_cash) : "—"}
                    </TD>
                    <TD>
                      {s.variance !== null ? (
                        <span className={cn("font-medium", varianceClass(Number(s.variance)))}>
                          {formatPeso(s.variance)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-latte">{s.variance_reason ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      </div>

      {/* -------------------------------------------- paid in / out dialog */}
      <Dialog
        open={moveKind !== null}
        onClose={() => setMoveKind(null)}
        title={moveKind === "paid_out" ? "Paid out" : "Paid in"}
        description={
          moveKind === "paid_out"
            ? "Cash taken out of the drawer, e.g. a supplier COD payment."
            : "Cash added to the drawer outside of sales, e.g. a change float."
        }
      >
        <form onSubmit={submitMove} className="space-y-4">
          {moveError && <Alert tone="danger">{moveError}</Alert>}
          <Field label="Amount (₱)">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={move.amount}
              onChange={(e) => setMove({ ...move, amount: e.target.value })}
            />
          </Field>
          <Field label="Reason" hint="Required; recorded in the audit log.">
            <Input
              required
              value={move.reason}
              onChange={(e) => setMove({ ...move, reason: e.target.value })}
              placeholder={
                moveKind === "paid_out" ? "e.g. paid water delivery" : "e.g. extra coins"
              }
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={move.notes}
              onChange={(e) => setMove({ ...move, notes: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setMoveKind(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={moveBusy}>
              Record {moveKind === "paid_out" ? "paid out" : "paid in"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* -------------------------------------------- close shift dialog */}
      <Dialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Close shift"
        description="Count the drawer and enter the actual cash. Expected cash is compared after you submit."
      >
        <form onSubmit={submitClose} className="space-y-4">
          {closeError && <Alert tone="danger">{closeError}</Alert>}
          <Field label="Actual cash counted (₱)">
            <Input
              type="number"
              min="0"
              step="0.01"
              required
              value={close.actual}
              onChange={(e) => setClose({ ...close, actual: e.target.value })}
            />
          </Field>
          <Field label="Variance reason (required if the drawer is over/short)">
            <Textarea
              value={close.reason}
              onChange={(e) => setClose({ ...close, reason: e.target.value })}
              placeholder="e.g. gave wrong change on a busy rush"
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={close.notes}
              onChange={(e) => setClose({ ...close, notes: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={closeBusy}>
              Close shift
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational bits
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-sm text-latte">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold text-espresso", className)}>{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between">
      <span className="text-roast">{label}</span>
      <span className="font-medium text-espresso">{value}</span>
    </li>
  );
}
