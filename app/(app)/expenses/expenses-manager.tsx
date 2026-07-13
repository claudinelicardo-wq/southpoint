"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Row shapes (mirrors supabase/migrations/0008_expenses.sql)
// ---------------------------------------------------------------------------

export type ExpenseStatus = "pending" | "approved" | "rejected";

export interface ExpenseRow {
  id: string;
  exp_number: string;
  expense_date: string;
  vendor: string;
  description: string;
  amount: number;
  method: string;
  reference_no: string | null;
  is_recurring: boolean;
  notes: string | null;
  status: ExpenseStatus;
  created_by: string;
  created_at: string;
  expense_categories: { name: string } | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  sort_order: number;
}

export interface ProfileRow {
  id: string;
  full_name: string;
}

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const STATUS_BADGES: Record<ExpenseStatus, { tone: BadgeTone; label: string }> = {
  pending: { tone: "warning", label: "Pending" },
  approved: { tone: "success", label: "Approved" },
  rejected: { tone: "danger", label: "Rejected" },
};

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "maya", label: "Maya" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
];

function methodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

type StatusFilter = "all" | ExpenseStatus;

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

/** Today's date in Asia/Manila as YYYY-MM-DD. */
function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The last 12 months (current first) as { key: "YYYY-MM", label: "July 2026" }. */
function lastTwelveMonths(): { key: string; label: string }[] {
  const today = manilaToday();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const fmt = new Intl.DateTimeFormat("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const months: { key: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    months.push({ key, label: fmt.format(d) });
  }
  return months;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export function ExpensesManager({
  expenses,
  categories,
  profiles,
  canManage,
  canApprove,
  preview,
}: {
  expenses: ExpenseRow[];
  categories: CategoryRow[];
  profiles: ProfileRow[];
  canManage: boolean;
  canApprove: boolean;
  preview: boolean;
}) {
  const [recordOpen, setRecordOpen] = useState(false);
  const [approving, setApproving] = useState<ExpenseRow | null>(null);
  const [rejecting, setRejecting] = useState<ExpenseRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");

  const months = useMemo(() => lastTwelveMonths(), []);
  const currentMonth = months[0]?.key ?? "";

  const creatorNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of profiles) map.set(p.id, p.full_name);
    return map;
  }, [profiles]);

  const summary = useMemo(() => {
    const approvedThisMonth = expenses.filter(
      (e) => e.status === "approved" && e.expense_date.slice(0, 7) === currentMonth,
    );
    const approvedTotal = approvedThisMonth.reduce((acc, e) => acc + Number(e.amount), 0);

    const pending = expenses.filter((e) => e.status === "pending");
    const pendingTotal = pending.reduce((acc, e) => acc + Number(e.amount), 0);

    const byCategory = new Map<string, number>();
    for (const e of approvedThisMonth) {
      const name = e.expense_categories?.name ?? "Uncategorized";
      byCategory.set(name, (byCategory.get(name) ?? 0) + Number(e.amount));
    }
    let topCategory: { name: string; total: number } | null = null;
    for (const [name, total] of byCategory) {
      if (!topCategory || total > topCategory.total) topCategory = { name, total };
    }

    return { approvedTotal, pendingCount: pending.length, pendingTotal, topCategory };
  }, [expenses, currentMonth]);

  const filtered = expenses.filter(
    (e) =>
      (statusFilter === "all" || e.status === statusFilter) &&
      (monthFilter === "all" || e.expense_date.slice(0, 7) === monthFilter),
  );

  return (
    <div className="space-y-6">
      {preview && (
        <Alert tone="warning">Expenses need a connected Supabase project.</Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium uppercase tracking-wide text-latte">
              Approved this month
            </p>
            <p className="mt-2 text-lg font-semibold text-espresso">
              {formatPeso(summary.approvedTotal)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium uppercase tracking-wide text-latte">
              Pending approval
            </p>
            <p className="mt-2 text-lg font-semibold text-espresso">
              {formatPeso(summary.pendingTotal)}
              <span className="ml-1 text-xs font-normal text-latte">
                {summary.pendingCount === 1
                  ? "· 1 expense"
                  : `· ${summary.pendingCount} expenses`}
              </span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium uppercase tracking-wide text-latte">
              Top category this month
            </p>
            {summary.topCategory ? (
              <p className="mt-2 text-lg font-semibold text-espresso">
                {summary.topCategory.name}
                <span className="ml-1 text-xs font-normal text-latte">
                  · {formatPeso(summary.topCategory.total)}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-lg font-semibold text-latte">—</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={statusFilter === f.key ? "secondary" : "ghost"}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <Select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="w-auto"
            aria-label="Filter by month"
          >
            <option value="all">All months</option>
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        {canManage && (
          <Button onClick={() => setRecordOpen(true)} disabled={preview}>
            Record expense
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={expenses.length === 0 ? "No expenses yet" : "No matching expenses"}
          description={
            expenses.length === 0
              ? "Recorded expenses show up here with their approval status."
              : "Try a different status or month filter."
          }
        />
      ) : (
        <Table>
          <THead>
            <TH>Expense</TH>
            <TH>Date</TH>
            <TH>Category</TH>
            <TH>Vendor</TH>
            <TH>Description</TH>
            <TH className="text-right">Amount</TH>
            <TH>Method</TH>
            <TH>Status</TH>
            <TH>Recorded by</TH>
            {canApprove && <TH className="text-right">Actions</TH>}
          </THead>
          <TBody>
            {filtered.map((e) => (
              <TR key={e.id}>
                <TD className="font-medium text-espresso">{e.exp_number}</TD>
                <TD className="whitespace-nowrap text-latte">
                  {formatDate(e.expense_date)}
                </TD>
                <TD>
                  <Badge tone="neutral">
                    {e.expense_categories?.name ?? "Uncategorized"}
                  </Badge>
                </TD>
                <TD className="text-latte">{e.vendor || "—"}</TD>
                <TD>
                  {e.description}
                  {e.is_recurring && (
                    <Badge tone="info" className="ml-2">
                      Recurring
                    </Badge>
                  )}
                </TD>
                <TD className="text-right font-medium text-espresso">
                  {formatPeso(e.amount)}
                </TD>
                <TD className="text-latte">
                  {methodLabel(e.method)}
                  {e.reference_no && (
                    <span className="ml-1 text-xs">· {e.reference_no}</span>
                  )}
                </TD>
                <TD>
                  <Badge tone={STATUS_BADGES[e.status].tone}>
                    {STATUS_BADGES[e.status].label}
                  </Badge>
                </TD>
                <TD className="text-latte">
                  {creatorNames.get(e.created_by) ?? "—"}
                </TD>
                {canApprove && (
                  <TD className="text-right">
                    {e.status === "pending" && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setApproving(e)}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          onClick={() => setRejecting(e)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {recordOpen && (
        <RecordExpenseDialog
          categories={categories}
          onClose={() => setRecordOpen(false)}
        />
      )}
      {approving && (
        <ApproveDialog expense={approving} onClose={() => setApproving(null)} />
      )}
      {rejecting && (
        <RejectDialog expense={rejecting} onClose={() => setRejecting(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record dialog
// ---------------------------------------------------------------------------

function RecordExpenseDialog({
  categories,
  onClose,
}: {
  categories: CategoryRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    date: manilaToday(),
    category: categories[0]?.id ?? "",
    vendor: "",
    description: "",
    amount: "",
    method: "cash",
    reference: "",
    recurring: false,
    notes: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.category) {
      setError("Pick a category.");
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("expense_create", {
      p_date: form.date,
      p_category: form.category,
      p_vendor: form.vendor.trim(),
      p_description: form.description.trim(),
      p_amount: amount,
      p_method: form.method,
      p_reference: form.reference.trim() || null,
      p_receipt_url: null,
      p_recurring: form.recurring,
      p_notes: form.notes.trim() || null,
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
      title="Record expense"
      description="Approvers' expenses are approved automatically; everyone else's wait for approval."
      className="max-w-xl"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">
            <Input
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </Field>
          <Field label="Category">
            <Select
              required
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Vendor">
          <Input
            value={form.vendor}
            onChange={(e) => setForm({ ...form, vendor: e.target.value })}
            placeholder="e.g. Meralco"
          />
        </Field>
        <Field label="Description">
          <Input
            required
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What was this expense for?"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field label="Payment method">
            <Select
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Reference no." hint="Receipt or transaction number, if any.">
          <Input
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            placeholder="Optional"
          />
        </Field>
        <Switch
          checked={form.recurring}
          onChange={(v) => setForm({ ...form, recurring: v })}
          label="Recurring expense (e.g. rent, utilities)"
        />
        <Field label="Notes">
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Optional"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Record expense
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Approve / reject dialogs
// ---------------------------------------------------------------------------

function ApproveDialog({
  expense,
  onClose,
}: {
  expense: ExpenseRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function approve() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("expense_resolve", {
      p_expense: expense.id,
      p_approve: true,
      p_notes: null,
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
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={approve}
      title={`Approve ${expense.exp_number}`}
      message={
        error ??
        `Approve ${formatPeso(expense.amount)}${
          expense.vendor ? ` to ${expense.vendor}` : ""
        } for "${expense.description}"? This posts it to this month's totals.`
      }
      confirmLabel="Approve"
      tone="primary"
      loading={loading}
    />
  );
}

function RejectDialog({
  expense,
  onClose,
}: {
  expense: ExpenseRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("expense_resolve", {
      p_expense: expense.id,
      p_approve: false,
      p_notes: reason.trim(),
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
      title={`Reject ${expense.exp_number}`}
      description={`${formatPeso(expense.amount)} · ${expense.description}`}
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Reason (saved on the expense and audit log)">
          <Input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. missing receipt"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={loading}>
            Reject expense
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
