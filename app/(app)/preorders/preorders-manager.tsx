"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Textarea } from "@/components/ui/input";
import { formatPeso, formatQty } from "@/lib/format";
import { slotLabel, type PreorderItemSnapshot } from "@/lib/preorders";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PreorderRow {
  id: string;
  preorder_number: string;
  customer_name: string;
  customer_phone: string;
  pickup_date: string;
  pickup_slot: string;
  status: "pending" | "confirmed" | "ready" | "picked_up" | "rejected" | "cancelled";
  items: PreorderItemSnapshot[];
  total: number;
  gcash_reference: string;
  notes: string | null;
  reject_reason: string | null;
  created_at: string;
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const STATUS_BADGES: Record<PreorderRow["status"], { tone: BadgeTone; label: string }> = {
  pending: { tone: "warning", label: "Pending verification" },
  confirmed: { tone: "info", label: "Confirmed" },
  ready: { tone: "success", label: "Ready" },
  picked_up: { tone: "neutral", label: "Picked up" },
  rejected: { tone: "danger", label: "Rejected" },
  cancelled: { tone: "danger", label: "Cancelled" },
};

const NEXT_ACTION: Partial<
  Record<PreorderRow["status"], { to: PreorderRow["status"]; label: string }>
> = {
  pending: { to: "confirmed", label: "Confirm" },
  confirmed: { to: "ready", label: "Mark ready" },
  ready: { to: "picked_up", label: "Picked up" },
};

export function PreordersManager({
  preorders,
  migrationMissing,
  canHandle,
  preview,
}: {
  preorders: PreorderRow[];
  migrationMissing: boolean;
  canHandle: boolean;
  preview: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PreorderRow | null>(null);

  async function setStatus(id: string, status: PreorderRow["status"], reason?: string) {
    setError(null);
    setBusyId(id);
    const res = await fetch("/api/preorder/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, reason: reason ?? null }),
    });
    setBusyId(null);
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error ?? "Could not update the pre-order.");
      return false;
    }
    router.refresh();
    return true;
  }

  if (preview) {
    return <Alert tone="warning">Pre-orders need a connected Supabase project.</Alert>;
  }
  if (migrationMissing) {
    return (
      <Alert tone="warning" title="Migration not applied yet">
        The pre-orders table doesn&apos;t exist in the database yet. Apply migration
        0014_preorders.sql (Supabase dashboard → SQL editor), then enable pre-ordering in
        Settings.
      </Alert>
    );
  }

  const active = preorders.filter((p) => ["pending", "confirmed", "ready"].includes(p.status));
  const past = preorders.filter((p) => !["pending", "confirmed", "ready"].includes(p.status));

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      {active.length === 0 ? (
        <EmptyState
          title="No active pre-orders"
          description="New pre-orders from the public page land here for GCash verification."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {active.map((p) => (
            <Card key={p.id}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-espresso">{p.preorder_number}</p>
                    <p className="text-xs text-latte">
                      {p.pickup_date} · {slotLabel(String(p.pickup_slot).slice(0, 5))}
                    </p>
                  </div>
                  <Badge tone={STATUS_BADGES[p.status].tone}>{STATUS_BADGES[p.status].label}</Badge>
                </div>

                <div className="text-sm">
                  <p className="font-medium text-espresso">{p.customer_name}</p>
                  <a href={`tel:${p.customer_phone}`} className="text-court underline-offset-2 hover:underline">
                    {p.customer_phone}
                  </a>
                </div>

                <ul className="space-y-0.5 border-t border-line pt-2 text-sm">
                  {p.items.map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-2">
                      <span className="text-roast">
                        {formatQty(i.qty)} × {i.name}
                        {i.variant_name && <span className="text-latte"> · {i.variant_name}</span>}
                      </span>
                      <span className="text-espresso">{formatPeso(i.line_total)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-2 border-t border-line pt-1 font-semibold">
                    <span>Total</span>
                    <span>{formatPeso(p.total)}</span>
                  </li>
                </ul>

                <p className="rounded-lg bg-cream px-2.5 py-1.5 text-xs text-roast">
                  GCash ref: <span className="font-mono font-semibold">{p.gcash_reference}</span>
                  <span className="mt-0.5 block text-latte">
                    Check this against your GCash app before confirming.
                  </span>
                </p>
                {p.notes && <p className="text-xs italic text-latte">“{p.notes}”</p>}

                {canHandle && (
                  <div className="flex gap-2 pt-1">
                    {NEXT_ACTION[p.status] && (
                      <Button
                        size="sm"
                        loading={busyId === p.id}
                        onClick={() => setStatus(p.id, NEXT_ACTION[p.status]!.to)}
                      >
                        {NEXT_ACTION[p.status]!.label}
                      </Button>
                    )}
                    {p.status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-danger"
                        onClick={() => setRejecting(p)}
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-latte">
            Past pre-orders ({past.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {past.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-latte">
                <span className="font-medium text-roast">{p.preorder_number}</span>
                <span>{p.customer_name}</span>
                <span>{formatPeso(p.total)}</span>
                <Badge tone={STATUS_BADGES[p.status].tone}>{STATUS_BADGES[p.status].label}</Badge>
                {p.reject_reason && <span className="italic">({p.reject_reason})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {rejecting && (
        <RejectDialog
          preorder={rejecting}
          onClose={() => setRejecting(null)}
          onReject={async (reason) => {
            const ok = await setStatus(rejecting.id, "rejected", reason);
            if (ok) setRejecting(null);
          }}
        />
      )}
    </div>
  );
}

function RejectDialog({
  preorder,
  onClose,
  onReject,
}: {
  preorder: PreorderRow;
  onClose: () => void;
  onReject: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reject ${preorder.preorder_number}`}
      description="Use this when the GCash payment can't be verified or the order can't be fulfilled. Call the customer first if you can."
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await onReject(reason.trim());
          setBusy(false);
        }}
        className="space-y-4"
      >
        <Field label="Reason" hint="Kept on the pre-order record.">
          <Textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. GCash reference not found"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy}>
            Reject pre-order
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
