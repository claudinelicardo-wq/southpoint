"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Switch, Textarea } from "@/components/ui/input";
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
  first_name: string | null;
  last_name: string | null;
  member_no: string;
  member_status: "active" | "suspended";
  marketing_consent: boolean;
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
  first_name: string;
  last_name: string;
  marketing_consent: boolean;
  mobile: string;
  email: string;
  birthday: string;
  notes: string;
}

const EMPTY_FORM: CustomerForm = {
  first_name: "",
  last_name: "",
  marketing_consent: false,
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
  const [changingStatus, setChangingStatus] = useState<CustomerRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        c.member_no.toLowerCase().includes(q) ||
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
      first_name: c.first_name ?? c.full_name,
      last_name: c.last_name ?? "",
      marketing_consent: c.marketing_consent,
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

    const consentChanged = !editing || editing.marketing_consent !== form.marketing_consent;
    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      marketing_consent: form.marketing_consent,
      ...(consentChanged
        ? { marketing_consent_at: form.marketing_consent ? new Date().toISOString() : null }
        : {}),
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
      setError(
        dbError.message.includes("customers_mobile_unique")
          ? "That mobile number already belongs to another member."
          : dbError.message,
      );
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
      {error && !formOpen && !adjusting && !changingStatus && (
        <Alert tone="danger">{error}</Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          type="search"
          placeholder="Search name, member no., mobile, or email…"
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
                    {c.member_status === "suspended" && (
                      <Badge tone="danger" className="ml-2">
                        Suspended
                      </Badge>
                    )}
                    <span className="block font-mono text-xs font-normal text-latte">
                      {c.member_no}
                    </span>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className={c.member_status === "active" ? "text-danger" : undefined}
                          onClick={() => {
                            setError(null);
                            setChangingStatus(c);
                          }}
                          disabled={preview}
                        >
                          {c.member_status === "active" ? "Suspend" : "Reactivate"}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <Input
                required
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              />
            </Field>
            <Field label="Last name">
              <Input
                required={!editing}
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              />
            </Field>
            <Field label="Mobile" hint="One membership per number.">
              <Input
                type="tel"
                inputMode="tel"
                required={!editing}
                placeholder="09XX XXX XXXX"
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
          <Switch
            checked={form.marketing_consent}
            onChange={(v) => setForm({ ...form, marketing_consent: v })}
            label="Agreed to receive promos and updates"
          />
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

      {changingStatus && (
        <MemberStatusDialog
          customer={changingStatus}
          onClose={() => setChangingStatus(null)}
          onDone={() => {
            setChangingStatus(null);
            router.refresh();
          }}
        />
      )}

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

function MemberStatusDialog({
  customer,
  onClose,
  onDone,
}: {
  customer: CustomerRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const suspending = customer.member_status === "active";
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("loyalty_member_set_status", {
      p_customer: customer.id,
      p_status: suspending ? "suspended" : "active",
      p_reason: reason,
    });
    setLoading(false);
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
      title={`${suspending ? "Suspend" : "Reactivate"} ${customer.full_name}`}
      description={
        suspending
          ? "A suspended member keeps their points but cannot earn or redeem until reactivated."
          : "The member can earn and redeem points again."
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Reason (recorded in audit log)">
          <Input required value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant={suspending ? "danger" : "primary"} loading={loading}>
            {suspending ? "Suspend member" : "Reactivate member"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
