"use client";

import { GcashQr } from "@/components/gcash-qr";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatPeso } from "@/lib/format";
import { useState } from "react";
import type { PaymentMethod } from "./pos-screen";
import { round2 } from "./pos-types";

interface PayRow {
  method: string;
  // Kept as text for input UX (Number("") coercing to 0 on every keystroke
  // made the field snap back to "0" and block typing a new value).
  amount: string;
  reference_no: string;
  tendered: string; // keep as text for input UX; cash only
}

/** Payment capture with split-payment support. */
export function PaymentDialog({
  total,
  methods,
  gcashQrImage,
  busy,
  onSubmit,
  onClose,
}: {
  total: number;
  methods: PaymentMethod[];
  gcashQrImage?: string | null;
  busy: boolean;
  onSubmit: (
    payments: { method: string; amount: number; reference_no?: string; tendered?: number }[],
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PayRow[]>([
    { method: "cash", amount: String(total), reference_no: "", tendered: "" },
  ]);
  const [error, setError] = useState<string | null>(null);

  const paid = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const remaining = round2(total - paid);

  function setRow(i: number, patch: Partial<PayRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function methodOf(code: string) {
    return methods.find((m) => m.code === code);
  }

  async function submit() {
    setError(null);
    for (const r of rows) {
      const m = methodOf(r.method);
      if (!m) continue;
      if (m.requires_reference && !r.reference_no.trim()) {
        setError(`${m.name} needs a reference number.`);
        return;
      }
      if (m.kind === "cash" && r.tendered !== "" && Number(r.tendered) < Number(r.amount)) {
        setError("Tendered cash is less than the amount due.");
        return;
      }
    }
    if (remaining !== 0) {
      setError(
        remaining > 0
          ? `${formatPeso(remaining)} still unpaid.`
          : `Payments exceed the total by ${formatPeso(-remaining)}.`,
      );
      return;
    }
    const ok = await onSubmit(
      rows
        .filter((r) => Number(r.amount) > 0)
        .map((r) => ({
          method: r.method,
          amount: round2(Number(r.amount)),
          reference_no: r.reference_no.trim() || undefined,
          tendered: r.tendered === "" ? undefined : Number(r.tendered),
        })),
    );
    if (!ok) setError(null); // server error is shown by the POS screen
  }

  return (
    <Dialog open onClose={onClose} title={`Take payment: ${formatPeso(total)}`} className="max-w-xl">
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {rows.map((row, i) => {
          const m = methodOf(row.method);
          const change =
            m?.kind === "cash" && row.tendered !== ""
              ? round2(Number(row.tendered) - (Number(row.amount) || 0))
              : null;
          return (
            <div key={i} className="rounded-xl border border-line p-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {methods.map((pm) => (
                  <button
                    key={pm.code}
                    onClick={() => setRow(i, { method: pm.code })}
                    className={cn(
                      "min-h-10 rounded-lg border px-3 text-sm font-medium transition-colors",
                      row.method === pm.code
                        ? "border-court bg-court-soft text-court-deep"
                        : "border-line text-roast hover:border-latte",
                    )}
                  >
                    {pm.name}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amount (₱)">
                  <Input
                    type="number"
                    min="0"
                    step="0.25"
                    value={row.amount}
                    onChange={(e) => setRow(i, { amount: e.target.value })}
                  />
                </Field>
                {m?.kind === "cash" ? (
                  <Field label="Cash tendered" hint={change !== null ? `Change: ${formatPeso(Math.max(0, change))}` : undefined}>
                    <Input
                      type="number"
                      min="0"
                      step="0.25"
                      value={row.tendered}
                      onChange={(e) => setRow(i, { tendered: e.target.value })}
                      placeholder="Optional"
                    />
                  </Field>
                ) : m?.requires_reference ? (
                  <Field label="Reference number">
                    <Input
                      value={row.reference_no}
                      onChange={(e) => setRow(i, { reference_no: e.target.value })}
                      placeholder={`${m.name} ref no.`}
                    />
                  </Field>
                ) : (
                  <div />
                )}
              </div>
              {row.method === "gcash" && <GcashQr image={gcashQrImage ?? null} />}
              {rows.length > 1 && (
                <button
                  className="mt-2 text-xs text-danger underline"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  Remove payment
                </button>
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                {
                  method: "cash",
                  amount: String(Math.max(0, remaining)),
                  reference_no: "",
                  tendered: "",
                },
              ])
            }
          >
            Split payment
          </Button>
          <p
            className={cn(
              "text-sm font-semibold",
              remaining === 0 ? "text-court-deep" : "text-danger",
            )}
          >
            {remaining === 0
              ? "Fully covered"
              : remaining > 0
                ? `${formatPeso(remaining)} remaining`
                : `${formatPeso(-remaining)} over`}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="lg" onClick={submit} loading={busy} disabled={remaining !== 0}>
            Complete sale
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
