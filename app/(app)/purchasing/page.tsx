import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  PurchasingManager,
  type PayableRow,
  type PurchaseOrderListRow,
  type SupplierOption,
} from "./purchasing-manager";

export const metadata = { title: "Purchasing" };

export default async function PurchasingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "purchasing.view")) {
    redirect("/dashboard");
  }
  const canManage = can(session.permissions, session.profile.role, "purchasing.manage");

  let orders: PurchaseOrderListRow[] = [];
  let payables: PayableRow[] = [];
  let suppliers: SupplierOption[] = [];
  if (!session.preview) {
    const supabase = await createClient();
    const [o, p, s] = await Promise.all([
      supabase
        .from("purchase_orders")
        .select("*, suppliers(name)")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("v_po_payables").select("*"),
      supabase
        .from("suppliers")
        .select("id, name, payment_terms_days")
        .is("archived_at", null)
        .order("name"),
    ]);
    orders = (o.data as PurchaseOrderListRow[] | null) ?? [];
    payables = (p.data as PayableRow[] | null) ?? [];
    suppliers = (s.data as SupplierOption[] | null) ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Purchasing"
        description="Purchase orders, deliveries, and supplier payables. Receiving a delivery posts stock and costs to inventory."
      />
      <PurchasingManager
        orders={orders}
        payables={payables}
        suppliers={suppliers}
        canManage={canManage}
        preview={session.preview}
      />
    </div>
  );
}
