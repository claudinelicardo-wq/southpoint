import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  ExpensesManager,
  type CategoryRow,
  type ExpenseRow,
  type ProfileRow,
} from "./expenses-manager";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "expenses.view")) {
    redirect("/dashboard");
  }

  const canManage = can(session.permissions, session.profile.role, "expenses.manage");
  const canApprove = can(session.permissions, session.profile.role, "expenses.approve");

  let expenses: ExpenseRow[] = [];
  let categories: CategoryRow[] = [];
  let profiles: ProfileRow[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const [e, c, p] = await Promise.all([
      supabase
        .from("expenses")
        .select(
          "id, exp_number, expense_date, vendor, description, amount, method, reference_no, receipt_url, is_recurring, notes, status, created_by, created_at, expense_categories(name)",
        )
        .order("expense_date", { ascending: false })
        .limit(200),
      supabase
        .from("expense_categories")
        .select("id, name, sort_order")
        .is("archived_at", null)
        .order("sort_order"),
      supabase.from("profiles").select("id, full_name"),
    ]);
    expenses = (e.data as unknown as ExpenseRow[] | null) ?? [];
    categories = (c.data as CategoryRow[] | null) ?? [];
    profiles = (p.data as ProfileRow[] | null) ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Record operating expenses, track approvals, and keep spending by category in view."
      />
      <ExpensesManager
        expenses={expenses}
        categories={categories}
        profiles={profiles}
        canManage={canManage}
        canApprove={canApprove}
        preview={session.preview}
      />
    </div>
  );
}
