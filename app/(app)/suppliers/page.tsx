import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SuppliersManager, type Supplier } from "./suppliers-manager";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "suppliers.manage")) {
    redirect("/dashboard");
  }

  let suppliers: Supplier[] = [];
  const balances: Record<string, number> = {};
  if (!session.preview) {
    const supabase = await createClient();
    const [s, p] = await Promise.all([
      supabase.from("suppliers").select("*").is("archived_at", null).order("name"),
      supabase.from("v_po_payables").select("supplier_id, balance"),
    ]);
    suppliers = (s.data as Supplier[] | null) ?? [];
    const payables =
      (p.data as { supplier_id: string; balance: number }[] | null) ?? [];
    for (const row of payables) {
      balances[row.supplier_id] =
        (balances[row.supplier_id] ?? 0) + Number(row.balance);
    }
  }

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Vendors, contact details, payment terms, and outstanding purchase balances."
      />
      <SuppliersManager
        suppliers={suppliers}
        balances={balances}
        preview={session.preview}
      />
    </div>
  );
}
