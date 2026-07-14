"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Profile, StaffRole } from "@/lib/types";
import { ROLE_LABELS, STAFF_ROLES } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function StaffManager({
  staff,
  selfId,
  preview,
}: {
  staff: Profile[];
  selfId: string;
  preview: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Create form state
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "cashier" as StaffRole,
  });

  // Edit form state
  const [edit, setEdit] = useState({
    full_name: "",
    role: "cashier" as StaffRole,
    is_active: true,
    reason: "",
  });

  async function createStaff(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not create the staff account.");
      setLoading(false);
      return;
    }
    setLoading(false);
    setCreateOpen(false);
    setForm({ full_name: "", email: "", password: "", role: "cashier" });
    router.refresh();
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("staff_update", {
      p_user: editing.id,
      p_full_name: edit.full_name,
      p_role: edit.role,
      p_is_active: edit.is_active,
      p_reason: edit.reason || null,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {preview && (
        <Alert tone="warning">
          Staff management needs a connected Supabase project.
        </Alert>
      )}
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)} disabled={preview}>
          Add staff member
        </Button>
      </div>

      {staff.length === 0 ? (
        <EmptyState
          title="No staff yet"
          description="Add your team. Each person gets their own login and role-based access."
        />
      ) : (
        <Table>
          <THead>
            <TH>Name</TH>
            <TH>Role</TH>
            <TH>Status</TH>
            <TH>Joined</TH>
            <TH className="text-right">Actions</TH>
          </THead>
          <TBody>
            {staff.map((p) => (
              <TR key={p.id}>
                <TD className="font-medium">
                  {p.full_name || "—"}
                  {p.id === selfId && (
                    <span className="ml-2 text-xs text-latte">(you)</span>
                  )}
                </TD>
                <TD>
                  <Badge tone={p.role === "owner" ? "accent" : "neutral"}>
                    {ROLE_LABELS[p.role]}
                  </Badge>
                </TD>
                <TD>
                  <Badge tone={p.is_active ? "success" : "danger"}>
                    {p.is_active ? "Active" : "Deactivated"}
                  </Badge>
                </TD>
                <TD className="text-latte">{formatDate(p.created_at)}</TD>
                <TD className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(p);
                      setEdit({
                        full_name: p.full_name,
                        role: p.role,
                        is_active: p.is_active,
                        reason: "",
                      });
                      setError(null);
                    }}
                  >
                    Edit
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add staff member"
        description="They can sign in immediately with this email and password."
      >
        <form onSubmit={createStaff} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Full name">
            <Input
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Temporary password" hint="At least 8 characters. Ask them to change it after first sign-in.">
            <Input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create account
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.full_name || "staff member"}`}
      >
        <form onSubmit={saveEdit} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Full name">
            <Input
              required
              value={edit.full_name}
              onChange={(e) => setEdit({ ...edit, full_name: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select
              value={edit.role}
              onChange={(e) => setEdit({ ...edit, role: e.target.value as StaffRole })}
              disabled={editing?.id === selfId}
            >
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Switch
            checked={edit.is_active}
            onChange={(v) => setEdit({ ...edit, is_active: v })}
            label="Account active"
            disabled={editing?.id === selfId}
          />
          <Field label="Reason (recorded in audit log)">
            <Input
              value={edit.reason}
              onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
              placeholder="e.g. promoted to manager"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Save changes
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
