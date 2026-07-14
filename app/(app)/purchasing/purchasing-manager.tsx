"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Row shapes (mirrors supabase/migrations/0006_purchasing.sql)
// ---------------------------------------------------------------------------

export type PoStatus =
  | "draft"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled"
  | "closed";

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  status: PoStatus;
  order_date: string;
  expected_date: string | null;
  discount: number;
  tax: number;
  shipping: number;
  supplier_invoice_no: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderListRow extends PurchaseOrder {
  suppliers: { name: string } | null;
}

/** Row from the v_po_payables view (drafts and cancelled POs are excluded). */
export interface PayableRow {
  po_id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  status: PoStatus;
  order_date: string;
  expected_date: string | null;
  payment_terms_days: number;
  due_date: string;
  billed_amount: number;
  paid_amount: number;
  balance: number;
}

/** Active inventory item, as needed for PO line editing. */
export interface PurchaseItemOption {
  id: string;
  name: string;
  purchase_unit_label: string;
  purchase_to_base_factor: number;
  latest_cost: number;
}

export interface SupplierOption {
  id: string;
  name: string;
  payment_terms_days: number;
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export const PO_STATUS_BADGES: Record<PoStatus, { tone: BadgeTone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  sent: { tone: "info", label: "Sent" },
  partially_received: { tone: "warning", label: "Partially received" },
  received: { tone: "success", label: "Received" },
  cancelled: { tone: "danger", label: "Cancelled" },
  closed: { tone: "neutral", label: "Closed" },
};

/** Today's date (YYYY-MM-DD) in the store's timezone, for due-date checks. */
export function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
    new Date(),
  );
}

const OPEN_STATUSES: PoStatus[] = ["draft", "sent", "partially_received"];

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export function PurchasingManager({
  orders,
  payables,
  suppliers,
  canManage,
  preview,
}: {
  orders: PurchaseOrderListRow[];
  payables: PayableRow[];
  suppliers: SupplierOption[];
  canManage: boolean;
  preview: boolean;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  const payableByPo = useMemo(
    () => new Map(payables.map((p) => [p.po_id, p])),
    [payables],
  );

  const today = manilaToday();
  const openCount = orders.filter((o) => OPEN_STATUSES.includes(o.status)).length;
  const totalOutstanding = payables.reduce(
    (acc, p) => acc + Math.max(0, Number(p.balance)),
    0,
  );
  const overdueCount = payables.filter(
    (p) => Number(p.balance) > 0.005 && p.due_date < today,
  ).length;

  const summaries = [
    { label: "Open purchase orders", value: String(openCount) },
    { label: "Outstanding payables", value: formatPeso(totalOutstanding) },
    { label: "Overdue", value: String(overdueCount) },
  ];

  return (
    <div className="space-y-4">
      {preview && (
        <Alert tone="warning">Purchasing needs a connected Supabase project.</Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {summaries.map((s) => (
          <Card key={s.label}>
            <CardBody>
              <p className="text-sm text-latte">{s.label}</p>
              <p className="mt-1 text-lg font-semibold text-espresso">{s.value}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setCreateOpen(true)} disabled={preview}>
            New purchase order
          </Button>
        </div>
      )}

      {orders.length === 0 ? (
        <EmptyState
          title="No purchase orders yet"
          description="Create a purchase order to restock inventory. Receiving a delivery updates stock and costs automatically."
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)} disabled={preview}>
                New purchase order
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TH>PO number</TH>
            <TH>Supplier</TH>
            <TH>Status</TH>
            <TH>Order date</TH>
            <TH>Expected</TH>
            <TH className="text-right">Billed</TH>
            <TH className="text-right">Paid</TH>
            <TH className="text-right">Balance</TH>
          </THead>
          <TBody>
            {orders.map((o) => {
              const badge = PO_STATUS_BADGES[o.status];
              const payable = payableByPo.get(o.id);
              const overdue =
                payable !== undefined &&
                Number(payable.balance) > 0.005 &&
                payable.due_date < today;
              return (
                <TR key={o.id}>
                  <TD>
                    <Link
                      href={`/purchasing/${o.id}`}
                      className="font-medium text-espresso underline-offset-2 hover:underline"
                    >
                      {o.po_number}
                    </Link>
                  </TD>
                  <TD className="text-latte">{o.suppliers?.name ?? "—"}</TD>
                  <TD>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </TD>
                  <TD className="whitespace-nowrap text-latte">
                    {formatDate(o.order_date)}
                  </TD>
                  <TD className="whitespace-nowrap text-latte">
                    {o.expected_date ? formatDate(o.expected_date) : "—"}
                  </TD>
                  <TD className="text-right text-latte">
                    {payable ? formatPeso(payable.billed_amount) : "—"}
                  </TD>
                  <TD className="text-right text-latte">
                    {payable ? formatPeso(payable.paid_amount) : "—"}
                  </TD>
                  <TD className="text-right">
                    {payable ? (
                      <span
                        className={
                          overdue
                            ? "font-medium text-danger"
                            : "font-medium text-espresso"
                        }
                      >
                        {formatPeso(payable.balance)}
                      </span>
                    ) : (
                      <span className="text-latte">—</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {createOpen && (
        <CreatePoDialog suppliers={suppliers} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog — creates a draft via po_create, then opens the detail page.
// ---------------------------------------------------------------------------

function CreatePoDialog({
  suppliers,
  onClose,
}: {
  suppliers: SupplierOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      setError("Pick a supplier.");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("po_create", {
      p_supplier: supplierId,
      p_expected: expected || null,
      p_notes: notes.trim() || null,
    });
    if (rpcError) {
      setLoading(false);
      setError(rpcError.message);
      return;
    }
    router.push(`/purchasing/${String(data)}`);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New purchase order"
      description="Starts as a draft. Add line items on the next screen, then mark it as sent."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {suppliers.length === 0 ? (
          <Alert tone="warning">
            Add a supplier first. Purchase orders are placed with a supplier.
          </Alert>
        ) : (
          <Field label="Supplier">
            <Select
              required
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Expected delivery date" hint="Optional.">
          <Input
            type="date"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading} disabled={suppliers.length === 0}>
            Create draft
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
