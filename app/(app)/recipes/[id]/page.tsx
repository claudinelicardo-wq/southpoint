import { Badge } from "@/components/ui/badge";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import type {
  InventoryItem,
  Product,
  ProductVariant,
  RecipeIngredient,
} from "@/lib/catalog-types";
import { formatPeso } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RecipeEditor } from "./recipe-editor";

export const metadata = { title: "Recipes" };

type ProductRow = Product & { categories: { name: string } | null };

interface CostRow {
  product_id: string;
  variant_id: string | null;
  selling_price: number;
  estimated_cost: number;
}

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "catalog.manage")) {
    redirect("/dashboard");
  }
  // No data exists in preview mode, so any product id is unknown.
  if (session.preview) notFound();

  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("*, categories(name)")
    .eq("id", id)
    .maybeSingle<ProductRow>();
  if (!product || product.kind !== "prepared") notFound();

  const [v, r, inv, c] = await Promise.all([
    supabase
      .from("product_variants")
      .select("*")
      .eq("product_id", id)
      .order("sort_order"),
    supabase.from("recipe_ingredients").select("*").eq("product_id", id),
    supabase
      .from("inventory_items")
      .select("*")
      .is("archived_at", null)
      .order("name"),
    supabase.from("v_product_cost").select("*").eq("product_id", id),
  ]);
  const variants = (v.data as ProductVariant[] | null) ?? [];
  const lines = (r.data as RecipeIngredient[] | null) ?? [];
  const items = (inv.data as InventoryItem[] | null) ?? [];
  const costs = (c.data as CostRow[] | null) ?? [];

  // One card per variant, or a single base card when the product has none.
  const summaries = (variants.length > 0 ? variants : [null]).map((variant) => {
    const cost = costs.find((row) =>
      variant ? row.variant_id === variant.id : row.variant_id === null,
    );
    const price = variant
      ? Number(product.price) + Number(variant.price_delta)
      : Number(product.price);
    const estCost = Number(cost?.estimated_cost ?? 0);
    const marginPct = price > 0 ? ((price - estCost) / price) * 100 : null;
    return {
      key: variant?.id ?? "base",
      name: variant?.name ?? "Base recipe",
      price,
      estCost,
      marginPct,
    };
  });

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/recipes"
          className="text-sm text-latte underline-offset-2 hover:text-roast hover:underline"
        >
          &larr; Back to recipes
        </Link>
      </div>
      <PageHeader
        title={product.name}
        description="Recipe ingredients and estimated cost per serving, priced at inventory average cost."
        actions={<Badge tone="accent">{product.categories?.name ?? "Uncategorized"}</Badge>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((s) => (
          <Card key={s.key}>
            <CardBody>
              <p className="text-sm font-medium text-roast">{s.name}</p>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-latte">Selling price</span>
                  <span className="font-medium text-espresso">{formatPeso(s.price)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-latte">Estimated cost</span>
                  <span className="font-medium text-espresso">{formatPeso(s.estCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-latte">Gross margin</span>
                  <span className="font-medium text-espresso">
                    {s.marginPct === null ? "—" : `${s.marginPct.toFixed(1)}%`}
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <RecipeEditor product={product} variants={variants} lines={lines} items={items} />
    </div>
  );
}
