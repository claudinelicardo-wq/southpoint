import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { PreordersManager, type PreorderRow } from "./preorders-manager";

export const metadata = { title: "Pre-orders" };
export const dynamic = "force-dynamic";

export default async function PreordersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "orders.view")) {
    redirect("/dashboard");
  }

  let preorders: PreorderRow[] = [];
  let migrationMissing = false;
  if (!session.preview) {
    // Service-role read: the preorders table has no client RLS policies by
    // design (public submissions come through the validated API route).
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("preorders")
        .select("*")
        .order("pickup_date", { ascending: true })
        .order("pickup_slot", { ascending: true })
        .limit(200);
      if (error) migrationMissing = true;
      preorders = (data as PreorderRow[] | null) ?? [];
    } catch {
      migrationMissing = true;
    }
  }

  return (
    <div>
      <PageHeader
        title="Pre-orders"
        description="Customer pickup orders from the public pre-order page. Verify the GCash payment in your GCash app before confirming; ring the sale through the POS at pickup."
      />
      <PreordersManager
        preorders={preorders}
        migrationMissing={migrationMissing}
        canHandle={can(session.permissions, session.profile.role, "orders.view")}
        preview={session.preview}
      />
    </div>
  );
}
