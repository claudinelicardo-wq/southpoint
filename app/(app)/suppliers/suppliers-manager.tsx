"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Mirrors supabase/migrations/0006_purchasing.sql (suppliers).
export interface Supplier {
  id: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  payment_terms_days: number;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export function paymentTermsLabel(days: number): string {
  return days > 0 ? `Net ${days}` : "COD";
}

interface SupplierForm {
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  payment_terms_days: number;
  notes: string;
}

const EMPTY_FORM: SupplierForm = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  payment_terms_days: 0,
  notes: "",
};

export function SuppliersManager({
  suppliers,
  balances,
  preview,
}: {
  suppliers: Supplier[];
  /** Outstanding PO balance per supplier id, summed from v_po_payables. */
  balances: Record<string, number>;
  preview: boolean;
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<Supplier | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name,
      contact_person: s.contact_person,
      phone: s.phone,
      email: s.email,
      address: s.address,
      payment_terms_days: Number(s.payment_terms_days),
      notes: s.notes ?? "",
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
      name: form.name.trim(),
      contact_person: form.contact_person.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      payment_terms_days: form.payment_terms_days,
      notes: form.notes.trim() || null,
    };

    const { error: dbError } = editing
      ? await supabase.from("suppliers").update(payload).eq("id", editing.id)
      : await supabase.from("suppliers").insert(payload);

    setSaving(false);
    if (dbError) {
      setError(dbError.message);
      return;
    }
    setFormOpen(false);
    router.refresh();
  }

  async function archive() {
    if (!archiving) return;
    setArchiveBusy(true);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from("suppliers")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", archiving.id);
    setArchiveBusy(false);
    if (dbError) {
      setError(dbError.message);
      setArchiving(null);
      return;
    }
    setArchiving(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {preview && (
        <Alert tone="warning">Suppliers need a connected Supabase project.</Alert>
      )}
      {error && !formOpen && <Alert tone="danger">{error}</Alert>}

      <div className="flex justify-end">
        <Button onClick={openNew} disabled={preview}>
          Add supplier
        </Button>
      </div>

      {suppliers.length === 0 ? (
        <EmptyState
          title="No suppliers yet"
          description="Add the vendors you buy from — purchase orders and payables are tracked per supplier."
          action={
            <Button onClick={openNew} disabled={preview}>
              Add supplier
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TH>Name</TH>
            <TH>Contact person</TH>
            <TH>Phone</TH>
            <TH>Terms</TH>
            <TH className="text-right">Outstanding balance</TH>
            <TH className="text-right">Actions</TH>
          </THead>
          <TBody>
            {suppliers.map((s) => {
              const balance = balances[s.id] ?? 0;
              return (
                <TR key={s.id}>
                  <TD className="font-medium text-espresso">{s.name}</TD>
                  <TD className="text-latte">{s.contact_person || "—"}</TD>
                  <TD className="text-latte">{s.phone || "—"}</TD>
                  <TD className="text-latte">
                    {paymentTermsLabel(Number(s.payment_terms_days))}
                  </TD>
                  <TD
                    className={
                      balance > 0.005
                        ? "text-right font-medium text-espresso"
                        : "text-right text-latte"
                    }
                  >
                    {balance > 0.005 ? formatPeso(balance) : "—"}
                  </TD>
                  <TD className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(s)}
                      disabled={preview}
                    >
                      Edit
                    </Button>
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
        title={editing ? `Edit ${editing.name}` : "Add supplier"}
        description={
          editing ? undefined : "Contact details and payment terms for a vendor."
        }
      >
        <form onSubmit={save} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person">
              <Input
                value={form.contact_person}
                onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Payment terms (days)" hint="0 means cash on delivery.">
              <Input
                type="number"
                min="0"
                step="1"
                required
                value={form.payment_terms_days}
                onChange={(e) =>
                  setForm({ ...form, payment_terms_days: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <Field label="Address">
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <div className="flex items-center justify-between gap-2 pt-1">
            {editing ? (
              <Button
                variant="ghost"
                className="text-danger"
                onClick={() => {
                  setArchiving(editing);
                  setFormOpen(false);
                }}
              >
                Archive supplier
              </Button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {editing ? "Save changes" : "Add supplier"}
              </Button>
            </div>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        onConfirm={archive}
        title={`Archive ${archiving?.name ?? "supplier"}`}
        message="Archived suppliers are hidden from this list and from new purchase orders. Existing purchase orders and payables are kept."
        confirmLabel="Archive supplier"
        loading={archiveBusy}
      />
    </div>
  );
}
