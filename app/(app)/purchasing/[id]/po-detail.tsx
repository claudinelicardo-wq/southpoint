"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatDateTime, formatPeso, formatQty } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { paymentTermsLabel, type Supplier } from "../../suppliers/suppliers-manager";
import {
  manilaToday,
  PO_STATUS_BADGES,
  type PayableRow,
  type PoStatus,
  type PurchaseItemOption,
  type PurchaseOrder,
} from "../purchasing-manager";

// ---------------------------------------------------------------------------
// Row shapes (mirrors supabase/migrations/0006_purchasing.sql)
// ---------------------------------------------------------------------------

export interface POLine {
  id: string;
  po_id: string;
  item_id: string;
  qty_ordered: number;
  qty_received: number;
  qty_rejected: number;
  unit_cost: number;
  created_at: string;
  inventory_items: {
    name: string;
    purchase_unit_label: string;
    purchase_to_base_factor: number;
  } | null;
}

export interface GoodsReceiptItemRow {
  id: string;
  gr_id: string;
  po_item_id: string;
  qty_received: number;
  qty_rejected: number;
  unit_cost: number;
  expires_at: string | null;
}

export interface GoodsReceiptRow {
  id: string;
  gr_number: string;
  po_id: string;
  landed_cost: number;
  notes: string | null;
  received_at: string;
  goods_receipt_items: GoodsReceiptItemRow[];
}

export interface SupplierPaymentRow {
  id: string;
  supplier_id: string;
  po_id: string | null;
  amount: number;
  method: string;
  reference_no: string | null;
  notes: string | null;
  paid_at: string;
  created_at: string;
}

const PAYMENT_METHODS = ["cash", "gcash", "maya", "card", "bank"] as const;

/** Purchase units still expected on a line. */
function outstandingQty(line: POLine): number {
  return Number(line.qty_ordered) - Number(line.qty_received) - Number(line.qty_rejected);
}

function unitLabel(line: POLine): string {
  return line.inventory_items?.purchase_unit_label || "unit";
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export function PoDetail({
  po,
  supplier,
  lines,
  receipts,
  payments,
  payable,
  catalog,
  canManage,
  canReceive,
}: {
  po: PurchaseOrder;
  supplier: Supplier | null;
  lines: POLine[];
  receipts: GoodsReceiptRow[];
  payments: SupplierPaymentRow[];
  payable: PayableRow | null;
  catalog: PurchaseItemOption[];
  canManage: boolean;
  canReceive: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "cancel" | "charges" | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  // Charges are only editable while the PO is a draft.
  const [charges, setCharges] = useState({
    discount: String(Number(po.discount)),
    tax: String(Number(po.tax)),
    shipping: String(Number(po.shipping)),
  });

  const isDraft = po.status === "draft";
  const isReceivable =
    canReceive && (po.status === "sent" || po.status === "partially_received");
  const badge = PO_STATUS_BADGES[po.status];
  const today = manilaToday();
  const overdue =
    payable !== null && Number(payable.balance) > 0.005 && payable.due_date < today;

  const subtotal = lines.reduce(
    (acc, l) => acc + Number(l.qty_ordered) * Number(l.unit_cost),
    0,
  );
  const discount = Number(charges.discount) || 0;
  const tax = Number(charges.tax) || 0;
  const shipping = Number(charges.shipping) || 0;
  const total = subtotal + tax + shipping - discount;

  const lineById = new Map(lines.map((l) => [l.id, l]));

  async function markSent() {
    setBusy("send");
    setError(null);
    setSuccess(null);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("purchase_orders")
      .update({ status: "sent" })
      .eq("id", po.id);
    setBusy(null);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    setSuccess("Purchase order marked as sent. It can now receive deliveries.");
    router.refresh();
  }

  async function cancelPo() {
    setBusy("cancel");
    setError(null);
    setSuccess(null);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("purchase_orders")
      .update({ status: "cancelled" })
      .eq("id", po.id);
    setBusy(null);
    setCancelOpen(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    router.refresh();
  }

  async function saveCharges(e: React.FormEvent) {
    e.preventDefault();
    setBusy("charges");
    setError(null);
    setSuccess(null);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("purchase_orders")
      .update({ discount, tax, shipping })
      .eq("id", po.id);
    setBusy(null);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="no-print mb-4">
        <Link
          href="/purchasing"
          className="text-sm text-latte underline-offset-2 hover:text-roast hover:underline"
        >
          &larr; Back to purchasing
        </Link>
      </div>

      <PageHeader
        title={po.po_number}
        description={po.notes ?? undefined}
        actions={
          <>
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <Button
              variant="outline"
              size="sm"
              className="no-print"
              onClick={() => window.print()}
            >
              Print
            </Button>
          </>
        }
      />

      <div className="no-print space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {success && <Alert tone="success">{success}</Alert>}

        {(isDraft && canManage) || isReceivable ? (
          <div className="flex flex-wrap justify-end gap-2">
            {isDraft && canManage && (
              <>
                <Button
                  variant="ghost"
                  className="text-danger"
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel PO
                </Button>
                <Button
                  onClick={markSent}
                  loading={busy === "send"}
                  disabled={lines.length === 0}
                  title={lines.length === 0 ? "Add at least one line first" : undefined}
                >
                  Mark as sent
                </Button>
              </>
            )}
            {isReceivable && (
              <Button onClick={() => setReceiveOpen(true)}>Receive delivery</Button>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Supplier" />
          <CardBody className="space-y-1 text-sm">
            <p className="font-medium text-espresso">{supplier?.name ?? "—"}</p>
            {supplier?.contact_person && (
              <p className="text-latte">{supplier.contact_person}</p>
            )}
            {supplier?.phone && <p className="text-latte">{supplier.phone}</p>}
            {supplier?.email && <p className="text-latte">{supplier.email}</p>}
            {supplier?.address && <p className="text-latte">{supplier.address}</p>}
            <p className="text-latte">
              Terms: {paymentTermsLabel(Number(supplier?.payment_terms_days ?? 0))}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Order" />
          <CardBody className="space-y-1 text-sm">
            <p className="text-latte">
              Ordered:{" "}
              <span className="font-medium text-espresso">
                {formatDate(po.order_date)}
              </span>
            </p>
            <p className="text-latte">
              Expected:{" "}
              <span className="font-medium text-espresso">
                {po.expected_date ? formatDate(po.expected_date) : "—"}
              </span>
            </p>
            <p className="text-latte">
              Supplier invoice:{" "}
              <span className="font-medium text-espresso">
                {po.supplier_invoice_no ?? "—"}
              </span>
            </p>
            <p className="text-latte">Created {formatDateTime(po.created_at)}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Balance" />
          <CardBody className="space-y-1 text-sm">
            {payable ? (
              <>
                <p className="text-latte">
                  Billed:{" "}
                  <span className="font-medium text-espresso">
                    {formatPeso(payable.billed_amount)}
                  </span>
                </p>
                <p className="text-latte">
                  Paid:{" "}
                  <span className="font-medium text-espresso">
                    {formatPeso(payable.paid_amount)}
                  </span>
                </p>
                <p className="text-latte">
                  Balance:{" "}
                  <span
                    className={
                      Number(payable.balance) > 0.005
                        ? "font-semibold text-danger"
                        : "font-semibold text-court-deep"
                    }
                  >
                    {formatPeso(payable.balance)}
                  </span>
                </p>
                <p className="text-latte">
                  Due {formatDate(payable.due_date)}{" "}
                  {overdue && <Badge tone="danger">Overdue</Badge>}
                </p>
              </>
            ) : (
              <p className="text-latte">
                {po.status === "cancelled"
                  ? "Cancelled orders have no payable."
                  : "Billing starts once the order is sent and received."}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Lines */}
      <section className="mt-6">
        <h2 className="mb-3 font-display text-lg font-semibold text-espresso">
          Line items
        </h2>
        {lines.length === 0 ? (
          <EmptyState
            title="No lines yet"
            description={
              isDraft && canManage
                ? "Add the items to order below."
                : "This purchase order has no line items."
            }
          />
        ) : (
          <Table>
            <THead>
              <TH>Item</TH>
              <TH className="text-right">Ordered</TH>
              {!isDraft && (
                <>
                  <TH className="text-right">Received</TH>
                  <TH className="text-right">Rejected</TH>
                </>
              )}
              <TH className="text-right">Unit cost</TH>
              <TH className="text-right">Line total</TH>
              {isDraft && canManage && <TH className="text-right">Actions</TH>}
            </THead>
            <TBody>
              {lines.map((line) =>
                isDraft && canManage ? (
                  <DraftLineRow key={line.id} line={line} onError={setError} />
                ) : (
                  <TR key={line.id}>
                    <TD className="font-medium text-espresso">
                      {line.inventory_items?.name ?? "—"}
                      <span className="ml-2 text-xs text-latte">
                        {unitLabel(line)}
                      </span>
                    </TD>
                    <TD className="text-right text-espresso">
                      {formatQty(line.qty_ordered)}
                    </TD>
                    {!isDraft && (
                      <>
                        <TD className="text-right text-latte">
                          {formatQty(line.qty_received)}
                        </TD>
                        <TD className="text-right text-latte">
                          {formatQty(line.qty_rejected)}
                        </TD>
                      </>
                    )}
                    <TD className="text-right text-latte">
                      {formatPeso(line.unit_cost)}
                    </TD>
                    <TD className="text-right font-medium text-espresso">
                      {formatPeso(Number(line.qty_ordered) * Number(line.unit_cost))}
                    </TD>
                  </TR>
                ),
              )}
            </TBody>
          </Table>
        )}

        {isDraft && canManage && (
          <div className="no-print mt-4">
            <AddLineForm poId={po.id} catalog={catalog} onError={setError} />
          </div>
        )}

        {/* Charges + totals */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {isDraft && canManage ? (
            <Card className="no-print">
              <CardHeader
                title="Charges"
                description="Applied on top of the line subtotal."
              />
              <CardBody>
                <form onSubmit={saveCharges} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Discount (₱)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={charges.discount}
                        onChange={(e) =>
                          setCharges({ ...charges, discount: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Tax (₱)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={charges.tax}
                        onChange={(e) =>
                          setCharges({ ...charges, tax: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Shipping (₱)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={charges.shipping}
                        onChange={(e) =>
                          setCharges({ ...charges, shipping: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      loading={busy === "charges"}
                    >
                      Save charges
                    </Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          ) : (
            <div />
          )}

          <Card>
            <CardBody className="space-y-1 text-sm">
              <div className="flex justify-between text-latte">
                <span>Lines subtotal</span>
                <span>{formatPeso(subtotal)}</span>
              </div>
              <div className="flex justify-between text-latte">
                <span>Tax</span>
                <span>{formatPeso(tax)}</span>
              </div>
              <div className="flex justify-between text-latte">
                <span>Shipping</span>
                <span>{formatPeso(shipping)}</span>
              </div>
              <div className="flex justify-between text-latte">
                <span>Discount</span>
                <span>−{formatPeso(discount)}</span>
              </div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold text-espresso">
                <span>Total</span>
                <span>{formatPeso(total)}</span>
              </div>
            </CardBody>
          </Card>
        </div>
      </section>

      {/* Receipts history */}
      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold text-espresso">
          Deliveries
        </h2>
        {receipts.length === 0 ? (
          <EmptyState
            title="Nothing received yet"
            description="Goods receipts recorded against this purchase order will show up here."
          />
        ) : (
          <div className="space-y-4">
            {receipts.map((gr) => (
              <Card key={gr.id}>
                <CardHeader
                  title={gr.gr_number}
                  description={[
                    formatDateTime(gr.received_at),
                    Number(gr.landed_cost) > 0
                      ? `Landed cost ${formatPeso(gr.landed_cost)}`
                      : null,
                    gr.notes,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                <CardBody className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-latte">
                        <th className="px-5 py-2">Item</th>
                        <th className="px-5 py-2 text-right">Received</th>
                        <th className="px-5 py-2 text-right">Rejected</th>
                        <th className="px-5 py-2 text-right">Unit cost</th>
                        <th className="px-5 py-2">Expiry</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {gr.goods_receipt_items.map((gi) => {
                        const line = lineById.get(gi.po_item_id);
                        return (
                          <tr key={gi.id}>
                            <td className="px-5 py-2 text-espresso">
                              {line?.inventory_items?.name ?? "—"}
                            </td>
                            <td className="px-5 py-2 text-right text-espresso">
                              {formatQty(gi.qty_received)}{" "}
                              <span className="text-latte">
                                {line ? unitLabel(line) : ""}
                              </span>
                            </td>
                            <td className="px-5 py-2 text-right text-latte">
                              {formatQty(gi.qty_rejected)}
                            </td>
                            <td className="px-5 py-2 text-right text-latte">
                              {formatPeso(gi.unit_cost)}
                            </td>
                            <td className="px-5 py-2 text-latte">
                              {gi.expires_at ? formatDate(gi.expires_at) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Payments */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-espresso">
            Payments
          </h2>
          {canManage && payable !== null && (
            <Button
              size="sm"
              className="no-print"
              onClick={() => setPayOpen(true)}
            >
              Record payment
            </Button>
          )}
        </div>
        {payments.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description="Payments recorded against this purchase order will show up here."
          />
        ) : (
          <Table>
            <THead>
              <TH>Date</TH>
              <TH className="text-right">Amount</TH>
              <TH>Method</TH>
              <TH>Reference</TH>
              <TH>Notes</TH>
            </THead>
            <TBody>
              {payments.map((p) => (
                <TR key={p.id}>
                  <TD className="whitespace-nowrap text-latte">
                    {formatDate(p.paid_at)}
                  </TD>
                  <TD className="text-right font-medium text-espresso">
                    {formatPeso(p.amount)}
                  </TD>
                  <TD>
                    <Badge tone="neutral">{p.method}</Badge>
                  </TD>
                  <TD className="text-latte">{p.reference_no ?? "—"}</TD>
                  <TD className="text-latte">{p.notes ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {/* Dialogs */}
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={cancelPo}
        title={`Cancel ${po.po_number}`}
        message="Cancelling permanently closes this draft. It cannot be sent or received afterwards."
        confirmLabel="Cancel PO"
        loading={busy === "cancel"}
      />

      {receiveOpen && (
        <ReceiveDialog
          po={po}
          lines={lines}
          onClose={() => setReceiveOpen(false)}
          onSuccess={(msg) => {
            setReceiveOpen(false);
            setError(null);
            setSuccess(msg);
          }}
        />
      )}

      {payOpen && (
        <PaymentDialog
          po={po}
          balance={payable ? Math.max(0, Number(payable.balance)) : 0}
          onClose={() => setPayOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draft line editing
// ---------------------------------------------------------------------------

function DraftLineRow({
  line,
  onError,
}: {
  line: POLine;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(String(Number(line.qty_ordered)));
  const [cost, setCost] = useState(String(Number(line.unit_cost)));
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const dirty =
    Number(qty) !== Number(line.qty_ordered) ||
    Number(cost) !== Number(line.unit_cost);

  async function save() {
    const q = Number(qty);
    const c = Number(cost);
    if (!Number.isFinite(q) || q <= 0) {
      onError("Line quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(c) || c < 0) {
      onError("Line unit cost cannot be negative.");
      return;
    }
    setSaving(true);
    onError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("purchase_order_items")
      .update({ qty_ordered: q, unit_cost: c })
      .eq("id", line.id);
    setSaving(false);
    if (error) {
      onError(error.message);
      return;
    }
    router.refresh();
  }

  async function remove() {
    setRemoving(true);
    onError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("purchase_order_items")
      .delete()
      .eq("id", line.id);
    setRemoving(false);
    if (error) {
      onError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <TR>
      <TD className="font-medium text-espresso">
        {line.inventory_items?.name ?? "—"}
        <span className="ml-2 text-xs text-latte">{unitLabel(line)}</span>
      </TD>
      <TD className="text-right">
        <Input
          type="number"
          min="0.0001"
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="ml-auto w-24 text-right"
          aria-label={`Quantity of ${line.inventory_items?.name ?? "line"}`}
        />
      </TD>
      <TD className="text-right">
        <Input
          type="number"
          min="0"
          step="any"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="ml-auto w-28 text-right"
          aria-label={`Unit cost of ${line.inventory_items?.name ?? "line"}`}
        />
      </TD>
      <TD className="text-right font-medium text-espresso">
        {formatPeso((Number(qty) || 0) * (Number(cost) || 0))}
      </TD>
      <TD className="text-right">
        {dirty && (
          <Button variant="ghost" size="sm" onClick={save} loading={saving}>
            Save
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          onClick={remove}
          loading={removing}
        >
          Remove
        </Button>
      </TD>
    </TR>
  );
}

function AddLineForm({
  poId,
  catalog,
  onError,
}: {
  poId: string;
  catalog: PurchaseItemOption[];
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [adding, setAdding] = useState(false);

  function pickItem(id: string) {
    setItemId(id);
    const item = catalog.find((c) => c.id === id);
    if (item) {
      const defaultCost =
        Number(item.latest_cost) * Number(item.purchase_to_base_factor);
      setCost(defaultCost > 0 ? defaultCost.toFixed(2) : "");
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(qty);
    const c = Number(cost);
    if (!itemId) {
      onError("Pick an item to add.");
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      onError("Quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(c) || c < 0) {
      onError("Unit cost cannot be negative.");
      return;
    }
    setAdding(true);
    onError(null);
    const supabase = createClient();
    const { error } = await supabase.from("purchase_order_items").insert({
      po_id: poId,
      item_id: itemId,
      qty_ordered: q,
      unit_cost: c,
    });
    setAdding(false);
    if (error) {
      onError(error.message);
      return;
    }
    setItemId("");
    setQty("1");
    setCost("");
    router.refresh();
  }

  const selected = catalog.find((c) => c.id === itemId);

  return (
    <form
      onSubmit={add}
      className="rounded-xl border border-dashed border-line bg-paper p-4"
    >
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_10rem_auto]">
        <Field label="Add line">
          <Select
            value={itemId}
            onChange={(e) => pickItem(e.target.value)}
            aria-label="Item to add"
          >
            <option value="">Pick an item…</option>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.purchase_unit_label ? ` · ${c.purchase_unit_label}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Qty${selected?.purchase_unit_label ? ` (${selected.purchase_unit_label})` : ""}`}>
          <Input
            type="number"
            min="0.0001"
            step="any"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        <Field label="Unit cost (₱)">
          <Input
            type="number"
            min="0"
            step="any"
            required
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="secondary" loading={adding}>
          Add
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Receive delivery dialog
// ---------------------------------------------------------------------------

interface ReceiveRow {
  qty: string;
  rejected: string;
  cost: string;
  expires: string;
}

function ReceiveDialog({
  po,
  lines,
  onClose,
  onSuccess,
}: {
  po: PurchaseOrder;
  lines: POLine[];
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const router = useRouter();
  const outstanding = lines.filter((l) => outstandingQty(l) > 0.0001);

  const [rows, setRows] = useState<Record<string, ReceiveRow>>(() =>
    Object.fromEntries(
      outstanding.map((l) => [
        l.id,
        {
          qty: String(outstandingQty(l)),
          rejected: "",
          cost: String(Number(l.unit_cost)),
          expires: "",
        },
      ]),
    ),
  );
  const [landed, setLanded] = useState("");
  const [invoice, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateRow(id: string, patch: Partial<ReceiveRow>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const items: {
      po_item_id: string;
      qty_received: number;
      qty_rejected: number;
      unit_cost: number;
      expires_at: string | null;
    }[] = [];

    for (const line of outstanding) {
      const row = rows[line.id];
      if (!row) continue;
      const qty = Number(row.qty) || 0;
      const rejected = Number(row.rejected) || 0;
      const cost = Number(row.cost);
      const name = line.inventory_items?.name ?? "line";
      if (qty < 0 || rejected < 0) {
        setError(`Quantities for ${name} cannot be negative.`);
        return;
      }
      if (qty === 0 && rejected === 0) continue; // untouched line
      if (qty + rejected > outstandingQty(line) + 0.0001) {
        setError(
          `${name}: receiving ${formatQty(qty + rejected)} but only ${formatQty(outstandingQty(line))} ${unitLabel(line)} outstanding.`,
        );
        return;
      }
      if (!Number.isFinite(cost) || cost < 0) {
        setError(`${name}: unit cost cannot be negative.`);
        return;
      }
      items.push({
        po_item_id: line.id,
        qty_received: qty,
        qty_rejected: rejected,
        unit_cost: cost,
        expires_at: row.expires || null,
      });
    }

    if (items.length === 0) {
      setError("Enter a received or rejected quantity on at least one line.");
      return;
    }
    const landedCost = Number(landed) || 0;
    if (landedCost < 0) {
      setError("Landed cost cannot be negative.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("po_receive", {
      p_po: po.id,
      p_items: items,
      p_landed_cost: landedCost,
      p_invoice_no: invoice.trim() || null,
      p_notes: notes.trim() || null,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const result = data as { gr_number: string; status: PoStatus };
    onSuccess(
      `Delivery recorded as ${result.gr_number}. The order is now ${PO_STATUS_BADGES[result.status].label.toLowerCase()}.`,
    );
    router.refresh();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Receive delivery: ${po.po_number}`}
      description="Quantities are in purchase units. Received stock is converted to base units and posted to inventory."
      className="max-w-2xl"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="space-y-3">
          {outstanding.map((line) => {
            const row = rows[line.id];
            if (!row) return null;
            return (
              <div key={line.id} className="rounded-xl border border-line p-3">
                <p className="mb-2 text-sm font-medium text-espresso">
                  {line.inventory_items?.name ?? "—"}
                  <span className="ml-2 font-normal text-latte">
                    {formatQty(outstandingQty(line))} {unitLabel(line)} outstanding
                  </span>
                </p>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Qty received">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={row.qty}
                      onChange={(e) => updateRow(line.id, { qty: e.target.value })}
                    />
                  </Field>
                  <Field label="Qty rejected">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={row.rejected}
                      onChange={(e) =>
                        updateRow(line.id, { rejected: e.target.value })
                      }
                      placeholder="0"
                    />
                  </Field>
                  <Field label="Unit cost (₱)">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={row.cost}
                      onChange={(e) => updateRow(line.id, { cost: e.target.value })}
                    />
                  </Field>
                  <Field label="Expiry">
                    <Input
                      type="date"
                      value={row.expires}
                      onChange={(e) =>
                        updateRow(line.id, { expires: e.target.value })
                      }
                    />
                  </Field>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Landed cost (₱)"
            hint="Freight and handling, allocated across received lines by value."
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              value={landed}
              onChange={(e) => setLanded(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Supplier invoice no.">
            <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Record delivery
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Record payment dialog
// ---------------------------------------------------------------------------

function PaymentDialog({
  po,
  balance,
  onClose,
}: {
  po: PurchaseOrder;
  balance: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "");
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(manilaToday());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("supplier_pay", {
      p_supplier: po.supplier_id,
      p_amount: value,
      p_method: method,
      p_po: po.id,
      p_reference: reference.trim() || null,
      p_notes: notes.trim() || null,
      p_paid_at: date || null,
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
      title={`Record payment: ${po.po_number}`}
      description={`Outstanding balance: ${formatPeso(balance)}`}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (₱)">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference no.">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Payment date">
            <Input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Record payment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
