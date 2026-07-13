import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Product, ProductVariant, RecipeIngredient } from "@/lib/catalog-types";
import { formatPeso } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata = { title: "Recipes" };

type ProductRow = Product & { categories: { name: string } | null };

interface CostRow {
  product_id: string;
  variant_id: string | null;
  selling_price: number;
  estimated_cost: number;
}

function foodCostTone(pct: number): "success" | "warning" | "danger" {
  if (pct <= 35) return "success";
  if (pct <= 45) return "warning";
  return "danger";
}

export default async function RecipesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "catalog.manage")) {
    redirect("/dashboard");
  }

  let products: ProductRow[] = [];
  let costs: CostRow[] = [];
  let variants: ProductVariant[] = [];
  let lines: RecipeIngredient[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const [p, c, v, r] = await Promise.all([
      supabase
        .from("products")
        .select("*, categories(name)")
        .eq("kind", "prepared")
        .is("archived_at", null)
        .order("name"),
      supabase.from("v_product_cost").select("*"),
      supabase.from("product_variants").select("*").order("sort_order"),
      supabase.from("recipe_ingredients").select("*"),
    ]);
    products = (p.data as ProductRow[] | null) ?? [];
    costs = (c.data as CostRow[] | null) ?? [];
    variants = (v.data as ProductVariant[] | null) ?? [];
    lines = (r.data as RecipeIngredient[] | null) ?? [];
  }

  const rows = products.map((product) => {
    const productVariants = variants.filter((v) => v.product_id === product.id);
    const defaultVariant =
      productVariants.find((v) => v.is_default) ?? productVariants[0] ?? null;
    const cost = defaultVariant
      ? costs.find(
          (c) => c.product_id === product.id && c.variant_id === defaultVariant.id,
        )
      : costs.find((c) => c.product_id === product.id && c.variant_id === null);

    const lineCount = lines.filter((l) => l.product_id === product.id).length;
    const price = Number(cost?.selling_price ?? product.price);
    const estCost = Number(cost?.estimated_cost ?? 0);
    const grossProfit = price - estCost;
    const foodCostPct = price > 0 ? (estCost / price) * 100 : null;
    const marginPct = price > 0 ? (grossProfit / price) * 100 : null;

    return { product, defaultVariant, lineCount, price, estCost, grossProfit, foodCostPct, marginPct };
  });

  return (
    <div>
      <PageHeader
        title="Recipes"
        description="Ingredient recipes for prepared items, with live cost and margin estimates from inventory average costs."
      />
      <div className="space-y-4">
        {session.preview && (
          <Alert tone="warning">Recipes need a connected Supabase project.</Alert>
        )}
        {rows.length === 0 ? (
          <EmptyState
            title="No prepared products yet"
            description="Create prepared items under Menu first — then define their recipes here to track cost and margin."
          />
        ) : (
          <Table>
            <THead>
              <TH>Product</TH>
              <TH>Category</TH>
              <TH className="text-right">Recipe lines</TH>
              <TH className="text-right">Price</TH>
              <TH className="text-right">Est. cost</TH>
              <TH className="text-right">Gross profit</TH>
              <TH className="text-right">Food cost %</TH>
              <TH className="text-right">Margin %</TH>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.product.id}>
                  <TD className="font-medium">
                    <Link
                      href={`/recipes/${r.product.id}`}
                      className="text-espresso underline-offset-2 hover:underline"
                    >
                      {r.product.name}
                    </Link>
                    {r.defaultVariant && (
                      <span className="ml-2 text-xs text-latte">
                        ({r.defaultVariant.name})
                      </span>
                    )}
                  </TD>
                  <TD className="text-latte">{r.product.categories?.name ?? "—"}</TD>
                  <TD className="text-right">{r.lineCount}</TD>
                  <TD className="text-right">{formatPeso(r.price)}</TD>
                  <TD className="text-right">{formatPeso(r.estCost)}</TD>
                  <TD className="text-right">{formatPeso(r.grossProfit)}</TD>
                  <TD className="text-right">
                    {r.foodCostPct === null ? (
                      <Badge tone="neutral">—</Badge>
                    ) : (
                      <Badge tone={foodCostTone(r.foodCostPct)}>
                        {r.foodCostPct.toFixed(1)}%
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-right">
                    {r.marginPct === null ? "—" : `${r.marginPct.toFixed(1)}%`}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}
