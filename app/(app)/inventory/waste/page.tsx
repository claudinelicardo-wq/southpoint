import { PageHeader } from "@/components/ui/card";
import type { InventoryItem, Product, ProductVariant } from "@/lib/catalog-types";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InventoryTabs } from "../inventory-links";
import { WasteManager, type WasteRecordRow } from "./waste-manager";

export const metadata = { title: "Waste" };

const headerLink =
  "text-sm text-latte underline-offset-2 hover:text-roast hover:underline";

export default async function WastePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canWaste = can(session.permissions, session.profile.role, "inventory.waste");
  const canView = can(session.permissions, session.profile.role, "inventory.view");
  if (!canWaste && !canView) redirect("/dashboard");

  let records: WasteRecordRow[] = [];
  let profileNames: Record<string, string> = {};
  let items: Pick<InventoryItem, "id" | "name" | "base_unit">[] = [];
  let products: Pick<Product, "id" | "name">[] = [];
  let variants: Pick<ProductVariant, "id" | "product_id" | "name">[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const [w, p, inv, prod, vars] = await Promise.all([
      supabase
        .from("waste_records")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("profiles").select("id, full_name"),
      supabase
        .from("inventory_items")
        .select("id, name, base_unit")
        .is("archived_at", null)
        .order("name"),
      supabase
        .from("products")
        .select("id, name")
        .eq("kind", "prepared")
        .is("archived_at", null)
        .order("name"),
      supabase.from("product_variants").select("id, product_id, name").order("sort_order"),
    ]);
    records = (w.data as WasteRecordRow[] | null) ?? [];
    profileNames = Object.fromEntries(
      ((p.data as { id: string; full_name: string }[] | null) ?? []).map((row) => [
        row.id,
        row.full_name,
      ]),
    );
    items = inv.data ?? [];
    products = prod.data ?? [];
    variants = vars.data ?? [];
  }

  return (
    <div>
      <InventoryTabs active="waste" />
      <PageHeader
        title="Waste"
        description="Report spoilage, spillage, staff meals, and comps. Approved records deduct stock at cost."
        actions={
          <>
            <Link href="/inventory" className={headerLink}>
              Inventory items
            </Link>
            <Link href="/inventory/counts" className={headerLink}>
              Stock counts
            </Link>
          </>
        }
      />
      <WasteManager
        records={records}
        profileNames={profileNames}
        items={items}
        products={products}
        variants={variants}
        canReport={canWaste}
        canApprove={can(
          session.permissions,
          session.profile.role,
          "inventory.waste.approve",
        )}
        preview={session.preview}
      />
    </div>
  );
}
