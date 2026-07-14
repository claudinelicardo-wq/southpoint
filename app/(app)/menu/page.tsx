import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type {
  Category,
  ModifierGroup,
  ModifierOption,
  ModifierOptionEffect,
  Product,
  ProductVariant,
  InventoryItem,
} from "@/lib/catalog-types";
import { redirect } from "next/navigation";
import { MenuManager } from "./menu-manager";

export const metadata = { title: "Menu" };

export default async function MenuPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "catalog.manage")) {
    redirect("/dashboard");
  }

  let categories: Category[] = [];
  let products: Product[] = [];
  let variants: ProductVariant[] = [];
  let groups: ModifierGroup[] = [];
  let options: ModifierOption[] = [];
  let effects: ModifierOptionEffect[] = [];
  let productGroups: { product_id: string; group_id: string }[] = [];
  let items: InventoryItem[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const [c, p, v, g, o, e, pg, inv] = await Promise.all([
      supabase.from("categories").select("*").is("archived_at", null).order("sort_order"),
      supabase.from("products").select("*").eq("kind", "prepared").is("archived_at", null).order("name"),
      supabase.from("product_variants").select("*").order("sort_order"),
      supabase.from("modifier_groups").select("*").is("archived_at", null).order("sort_order"),
      supabase.from("modifier_options").select("*").order("sort_order"),
      supabase.from("modifier_option_effects").select("*"),
      supabase.from("product_modifier_groups").select("product_id, group_id"),
      supabase.from("inventory_items").select("*").is("archived_at", null).order("name"),
    ]);
    categories = c.data ?? [];
    products = p.data ?? [];
    variants = v.data ?? [];
    groups = g.data ?? [];
    options = o.data ?? [];
    effects = e.data ?? [];
    productGroups = pg.data ?? [];
    items = inv.data ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Menu"
        description="Prepared cafe items, variants, and modifiers. Recipes are managed under Recipes."
      />
      <MenuManager
        categories={categories}
        products={products}
        variants={variants}
        groups={groups}
        options={options}
        effects={effects}
        productGroups={productGroups}
        items={items}
        preview={session.preview}
      />
    </div>
  );
}
