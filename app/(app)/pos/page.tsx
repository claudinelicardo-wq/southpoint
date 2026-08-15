import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type {
  Category,
  InventoryItem,
  ModifierGroup,
  ModifierOption,
  Product,
  ProductVariant,
} from "@/lib/catalog-types";
import { redirect } from "next/navigation";
import { POSScreen, type PaymentMethod, type OpenTab, type CustomerLite } from "./pos-screen";

export const metadata = { title: "POS" };

export default async function POSPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "pos.sell")) {
    redirect("/dashboard");
  }

  let categories: Category[] = [];
  let products: Product[] = [];
  let variants: ProductVariant[] = [];
  let groups: ModifierGroup[] = [];
  let options: ModifierOption[] = [];
  let productGroups: { product_id: string; group_id: string }[] = [];
  let retailStock: Pick<InventoryItem, "id" | "current_stock">[] = [];
  let paymentMethods: PaymentMethod[] = [];
  let openTabs: OpenTab[] = [];
  let customers: CustomerLite[] = [];
  let shiftId: string | null = null;
  let shiftOpenedAt: string | null = null;
  let taxConfig: Record<string, unknown> = {};
  let gcashQrImage: string | null = null;

  if (!session.preview) {
    const supabase = await createClient();
    const [c, p, v, g, o, pg, inv, pm, tabs, cust, shift, tax, receipt] = await Promise.all([
      supabase.from("categories").select("*").is("archived_at", null).order("sort_order"),
      supabase.from("products").select("*").is("archived_at", null).order("name"),
      supabase.from("product_variants").select("*").order("sort_order"),
      supabase.from("modifier_groups").select("*").is("archived_at", null).order("sort_order"),
      supabase.from("modifier_options").select("*").order("sort_order"),
      supabase.from("product_modifier_groups").select("product_id, group_id"),
      supabase.from("inventory_items").select("id, current_stock").eq("inventory_type", "retail"),
      supabase.from("payment_methods").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("tabs").select("id, name").eq("status", "open").order("opened_at"),
      supabase.from("customers").select("id, full_name, mobile").is("archived_at", null).order("full_name").limit(500),
      supabase.from("shifts").select("id, opened_at").eq("cashier_id", session.profile.id).eq("status", "open").maybeSingle(),
      supabase.from("settings").select("value").eq("key", "tax").single(),
      supabase.from("settings").select("value").eq("key", "receipt").single(),
    ]);
    categories = c.data ?? [];
    products = p.data ?? [];
    variants = v.data ?? [];
    groups = g.data ?? [];
    options = o.data ?? [];
    productGroups = pg.data ?? [];
    retailStock = inv.data ?? [];
    paymentMethods = pm.data ?? [];
    openTabs = tabs.data ?? [];
    customers = cust.data ?? [];
    shiftId = shift.data?.id ?? null;
    shiftOpenedAt = shift.data?.opened_at ?? null;
    taxConfig = (tax.data?.value ?? {}) as Record<string, unknown>;
    gcashQrImage = (receipt.data?.value as { gcash_qr_image?: string } | null)
      ?.gcash_qr_image ?? null;
  }

  return (
    <POSScreen
      categories={categories}
      products={products}
      variants={variants}
      groups={groups}
      options={options}
      productGroups={productGroups}
      retailStock={retailStock}
      paymentMethods={paymentMethods}
      openTabs={openTabs}
      customers={customers}
      shiftId={shiftId}
      shiftOpenedAt={shiftOpenedAt}
      taxConfig={taxConfig}
      gcashQrImage={gcashQrImage}
      canManualDiscount={can(session.permissions, session.profile.role, "pos.discount.manual")}
      preview={session.preview}
    />
  );
}
