import { PageHeader } from "@/components/ui/card";
import type { InventoryItem } from "@/lib/catalog-types";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { InventoryImport } from "./inventory-import";
import { InventoryManager } from "./inventory-manager";

export const metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "inventory.view")) {
    redirect("/dashboard");
  }

  let items: InventoryItem[] = [];
  if (!session.preview) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("inventory_items")
      .select("*")
      .is("archived_at", null)
      .order("name");
    items = (data as InventoryItem[] | null) ?? [];
  }

  const canAdjust = can(session.permissions, session.profile.role, "inventory.adjust");

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Stock levels, costs, and manual adjustments. Every stock change goes through the movement ledger."
        actions={<InventoryImport canImport={canAdjust} preview={session.preview} />}
      />
      <InventoryManager items={items} canAdjust={canAdjust} preview={session.preview} />
    </div>
  );
}
