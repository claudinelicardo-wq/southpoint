"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatQty } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

// Mirrors public.customers + public.loyalty_accounts (0003_pos.sql, 0009_loyalty.sql).
// Supabase returns an embedded to-one relationship as either an object or a
// single-element array depending on how it infers cardinality; accept both.
type LoyaltyEmbed =
  | { points_balance: number | string }
  | { points_balance: number | string }[]
  | null;

export interface CustomerRow {
  id: string;
  full_name: string;
  mobile: string | null;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  created_at: string;
  loyalty_accounts: LoyaltyEmbed;
}

function pointsOf(row: CustomerRow): number {
  const l = row.loyalty_accounts;
  const rec = Array.isArray(l) ? l[0] : l;
  return rec ? Number(rec.points_balance) : 0;
}

interface CustomerForm {
  full_name: string;
  mobile: string;
  email: string;
  birthday: string;
  notes: string;
}

const EMPTY_FORM: CustomerForm = {
  full_name: "",
  mobile: "",
  email: "",
  birthday: "",
  notes: "",
};

export function CustomersManager({
  customers,
  canManage,
  preview,
}: {
  customers: CustomerRow[];
  canManage: boolean;
  preview: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState<CustomerRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        (c.mobile ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q),
    );
  }, [customers, query]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(c: CustomerRow) {
    setEditing(c);
    setForm({
      full_name: c.full_name,
      mobile: c.mobile ?? "",
      email: c.email ?? "",
      birthday: c.birthday ?? "",
      notes: c.notes ?? "",
    });
    setError(null);
    setFormOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = createClient();

    const payload = {
      full_name: form.full_name.trim(),
      mobile: form.mobile.trim() || null,
      email: form.email.trim() || null,
      birthday: form.birthday || null,
      notes: form.notes.trim() || null,
    };

    const { error: dbError } = editing
      ? await supabase.from("customers").update(payload).eq("id", editing.id)
      : await supabase.from("customers").insert(payload);

    setSaving(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    setFormOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {preview && (
        <Alert tone="warning">Customer profiles need a connected Supabase project.</Alert>
      )}
      {error && !formOpen && !adjusting && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          type="search"
          placeholder="Search name, mobile, or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        {canManage && (
          <Button onClick={openNew} disabled={preview}>
            Add customer
          </Button>
        )}
      </div>

      {customers.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Add members to track spend, loyalty points, and open tabs."
          action={
            canManage ? (
              <Button onClick={openNew} disabled={preview}>
                Add customer
              </Button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description="No customer matches that search." />
      ) : (
        <Table>
          <THead>
            <TH>Name</TH>
            <TH>Mobile</TH>
            <TH>Email</TH>
            <TH className="text-right">Loyalty points</TH>
            <TH>Member since</TH>
            <TH className="text-right">Actions</TH>
          </THead>
          <TBody>
            {filtered.map((c) => {
              const pts = pointsOf(c);
              return (
                <TR key={c.id}>
                  <TD className="font-medium text-espresso">
                    {c.full_name}
                    {c.notes && <span className="block text-xs text-latte">{c.notes}</span>}
                  </TD>
                  <TD className="text-latte">{c.mobile || "—"}</TD>
                  <TD className="text-latte">{c.email || "—"}</TD>
                  <TD className="text-right">
                    {pts > 0 ? (
                      <Badge tone="success">{formatQty(pts)} pts</Badge>
                    ) : (
                      <span className="text-latte">0</span>
                    )}
                  </TD>
                  <TD className="text-latte whitespace-nowrap">{formatDate(c.created_at)}</TD>
                  <TD className="text-right">
                    {canManage && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(c)}
                          disabled={preview}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setError(null);
                            setAdjusting(c);
                          }}
                          disabled={preview}
                        >
                          Adjust points
                        </Button>
                      </>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {/* Create / Edit dialog */}
      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.full_name}` : "Add customer"}
        description={editing ? undefined : "A digital profile, no physical card needed."}
      >
        <form onSubmit={save} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Full name">
            <Input
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile">
              <Input
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Birthday" hint="Used for birthday rewards.">
              <Input
                type="date"
                value={form.birthday}
                onChange={(e) => setForm({ ...form, birthday: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save changes" : "Add customer"}
            </Button>
          </div>
        </form>
      </Dialog>

      {adjusting && (
        <AdjustPointsDialog
          customer={adjusting}
          currentPoints={pointsOf(adjusting)}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AdjustPointsDialog({
  customer,
  currentPoints,
  onClose,
  onDone,
}: {
  customer: CustomerRow;
  currentPoints: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const delta = Number(points);
    if (!Number.isFinite(delta) || delta === 0) {
      setError("Enter a non-zero point amount (use a negative value to deduct).");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("loyalty_adjust", {
      p_customer: customer.id,
      p_points: delta,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onDone();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Adjust points: ${customer.full_name}`}
      description={`Current balance: ${formatQty(currentPoints)} points. Adjustments are audited.`}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Points" hint="Positive to add, negative to deduct.">
          <Input
            type="number"
            step="any"
            required
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </Field>
        <Field label="Reason">
          <Textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. goodwill for a service delay"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Apply adjustment
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
