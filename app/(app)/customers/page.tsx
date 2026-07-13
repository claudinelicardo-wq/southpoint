import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CustomersManager, type CustomerRow } from "./customers-manager";

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "customers.view.basic")) {
    redirect("/dashboard");
  }
  const canManage = can(session.permissions, session.profile.role, "customers.manage");

  let customers: CustomerRow[] = [];
  if (!session.preview) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("customers")
      .select(
        "id, full_name, mobile, email, birthday, notes, created_at, loyalty_accounts(points_balance)",
      )
      .is("archived_at", null)
      .order("full_name")
      .limit(500);
    customers = (data as unknown as CustomerRow[] | null) ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Member profiles, contact details, and loyalty balances."
      />
      <CustomersManager
        customers={customers}
        canManage={canManage}
        preview={session.preview}
      />
    </div>
  );
}
