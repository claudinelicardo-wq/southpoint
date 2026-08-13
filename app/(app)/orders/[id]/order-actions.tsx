"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface RefundMethod {
  code: string;
  name: string;
}

export function OrderActions({
  orderId,
  refundableAmount,
  hasRefunds,
  canVoid,
  canRefund,
  methods,
}: {
  orderId: string;
  refundableAmount: number;
  /** Voiding is blocked once any refund has posted against the order. */
  hasRefunds: boolean;
  canVoid: boolean;
  canRefund: boolean;
  methods: RefundMethod[];
}) {
  const [dialog, setDialog] = useState<"void" | "refund" | null>(null);
  const showVoid = canVoid && !hasRefunds;
  const showRefund = canRefund && refundableAmount > 0;

  if (!showVoid && !showRefund) return null;

  return (
    <>
      <div className="flex gap-2">
        {showRefund && (
          <Button variant="outline" size="sm" onClick={() => setDialog("refund")}>
            Refund
          </Button>
        )}
        {showVoid && (
          <Button variant="danger" size="sm" onClick={() => setDialog("void")}>
            Void sale
          </Button>
        )}
      </div>
      {dialog === "void" && <VoidDialog orderId={orderId} onClose={() => setDialog(null)} />}
      {dialog === "refund" && (
        <RefundDialog
          orderId={orderId}
          refundableAmount={refundableAmount}
          methods={methods}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function VoidDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("order_void", {
      p_order: orderId,
      p_reason: reason.trim(),
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Void this sale"
      description="Reverses the payment and restocks everything it consumed. This cannot be undone — use it for a mistaken sale, not a customer return (use Refund for that)."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Reason" hint="Required — kept on the audit log.">
          <Textarea
            required
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. rang up the wrong item, customer walked away before paying"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={loading}>
            Void sale
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RefundDialog({
  orderId,
  refundableAmount,
  methods,
  onClose,
}: {
  orderId: string;
  refundableAmount: number;
  methods: RefundMethod[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(refundableAmount));
  const [method, setMethod] = useState(methods[0]?.code ?? "cash");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > refundableAmount) {
      setError(`Enter an amount between ₱0.01 and ${formatPeso(refundableAmount)}.`);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.rpc("order_refund", {
      p_order: orderId,
      p_amount: numAmount,
      p_method: method,
      p_reason: reason.trim(),
      p_restock: restock,
      p_idempotency_key: crypto.randomUUID(),
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Refund this sale"
      description={`Up to ${formatPeso(refundableAmount)} refundable. Reverses payment, and inventory/COGS/loyalty if you restock.`}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (₱)">
            <Input
              type="number"
              min="0"
              max={refundableAmount}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Refund method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {methods.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Reason" hint="Required — kept on the audit log.">
          <Textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. customer complaint, wrong order"
          />
        </Field>
        <Switch
          checked={restock}
          onChange={setRestock}
          label="Return items to stock"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Issue refund
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
