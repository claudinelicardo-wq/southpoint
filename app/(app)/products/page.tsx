import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Category, InventoryItem, Product } from "@/lib/catalog-types";
import { redirect } from "next/navigation";
import { ProductsManager } from "./products-manager";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = can(session.permissions, session.profile.role, "catalog.manage");
  const canView =
    canManage || can(session.permissions, session.profile.role, "inventory.view");
  if (!canView) redirect("/dashboard");

  let categories: Category[] = [];
  let products: Product[] = [];
  let items: InventoryItem[] = [];
  if (!session.preview) {
    const supabase = await createClient();
    const [c, p, inv] = await Promise.all([
      supabase.from("categories").select("*").is("archived_at", null).order("sort_order"),
      supabase.from("products").select("*").eq("kind", "retail").is("archived_at", null).order("name"),
      supabase.from("inventory_items").select("*").eq("inventory_type", "retail").is("archived_at", null).order("name"),
    ]);
    categories = c.data ?? [];
    products = p.data ?? [];
    items = inv.data ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Products"
        description="Convenience-store retail goods. Each product sells one unit of its linked stock item."
      />
      <ProductsManager
        categories={categories}
        products={products}
        items={items}
        canManage={canManage}
        preview={session.preview}
      />
    </div>
  );
}
