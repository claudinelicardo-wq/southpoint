"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type {
  InventoryItem,
  Product,
  ProductVariant,
  RecipeIngredient,
} from "@/lib/catalog-types";
import { formatPeso, formatQty } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const ALL_VARIANTS = "__all__";

export function RecipeEditor({
  product,
  variants,
  lines,
  items,
}: {
  product: Product;
  variants: ProductVariant[];
  lines: RecipeIngredient[];
  items: InventoryItem[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<RecipeIngredient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    item_id: "",
    qty: "1",
    waste_pct: "0",
    variant_id: ALL_VARIANTS,
    is_optional: false,
  });

  const itemsById = new Map(items.map((i) => [i.id, i]));
  const variantsById = new Map(variants.map((v) => [v.id, v]));

  function lineCost(line: RecipeIngredient): number | null {
    const item = itemsById.get(line.item_id);
    if (!item) return null;
    return Number(line.qty) * (1 + Number(line.waste_pct) / 100) * Number(item.avg_cost);
  }

  const baseRecipeCost = lines
    .filter((l) => l.variant_id === null)
    .reduce((sum, l) => sum + (lineCost(l) ?? 0), 0);

  function openAdd() {
    setForm({
      item_id: items[0]?.id ?? "",
      qty: "1",
      waste_pct: "0",
      variant_id: ALL_VARIANTS,
      is_optional: false,
    });
    setError(null);
    setAddOpen(true);
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const qty = Number(form.qty);
    const waste = Number(form.waste_pct);
    if (!form.item_id) {
      setError("Choose an ingredient.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(waste) || waste < 0 || waste >= 100) {
      setError("Waste % must be between 0 and 99.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("recipe_ingredients").insert({
      product_id: product.id,
      variant_id: form.variant_id === ALL_VARIANTS ? null : form.variant_id,
      item_id: form.item_id,
      qty,
      waste_pct: waste,
      is_optional: form.is_optional,
    });
    setLoading(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setAddOpen(false);
    router.refresh();
  }

  async function removeLine() {
    if (!removing) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("recipe_ingredients")
      .delete()
      .eq("id", removing.id);
    setLoading(false);
    if (deleteError) {
      setError(deleteError.message);
      setRemoving(null);
      return;
    }
    setRemoving(null);
    router.refresh();
  }

  const removingItem = removing ? itemsById.get(removing.item_id) : null;

  return (
    <Card>
      <CardHeader
        title="Recipe"
        description="Quantities are in each ingredient's base unit. Costs use inventory average cost."
        actions={
          <Button size="sm" onClick={openAdd} disabled={items.length === 0}>
            Add ingredient
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {error && !addOpen && !removing && <Alert tone="danger">{error}</Alert>}
        {items.length === 0 && (
          <Alert tone="warning">
            No active inventory items exist yet. Add ingredients under Inventory first.
          </Alert>
        )}

        {lines.length === 0 ? (
          <EmptyState
            title="No ingredients yet"
            description="Add the ingredients that go into one serving of this product to estimate its cost."
          />
        ) : (
          <Table>
            <THead>
              <TH>Ingredient</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Waste %</TH>
              <TH>Applies to</TH>
              <TH>Optional</TH>
              <TH className="text-right">Est. line cost</TH>
              <TH className="text-right">Actions</TH>
            </THead>
            <TBody>
              {lines.map((line) => {
                const item = itemsById.get(line.item_id);
                const variant = line.variant_id
                  ? variantsById.get(line.variant_id)
                  : null;
                const cost = lineCost(line);
                return (
                  <TR key={line.id}>
                    <TD className="font-medium">
                      {item?.name ?? "Archived item"}
                    </TD>
                    <TD className="text-right">
                      {formatQty(line.qty)}
                      {item && (
                        <span className="ml-1 text-xs text-latte">{item.base_unit}</span>
                      )}
                    </TD>
                    <TD className="text-right">{formatQty(line.waste_pct)}%</TD>
                    <TD>
                      {variant ? (
                        <Badge tone="info">{variant.name}</Badge>
                      ) : (
                        <Badge tone="neutral">All variants</Badge>
                      )}
                    </TD>
                    <TD>
                      {line.is_optional ? <Badge tone="warning">Optional</Badge> : "—"}
                    </TD>
                    <TD className="text-right">
                      {cost === null ? "—" : formatPeso(cost)}
                    </TD>
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setRemoving(line);
                        }}
                      >
                        Remove
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}

        <div className="flex items-center justify-between rounded-xl bg-sand/50 px-4 py-3 text-sm">
          <span className="font-medium text-roast">Base recipe cost</span>
          <span className="font-semibold text-espresso">{formatPeso(baseRecipeCost)}</span>
        </div>
      </CardBody>

      {/* Add ingredient dialog */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add ingredient"
        description={`Add a recipe line to ${product.name}.`}
      >
        <form onSubmit={addLine} className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Ingredient">
            <Select
              required
              value={form.item_id}
              onChange={(e) => setForm({ ...form, item_id: e.target.value })}
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.base_unit})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Quantity"
            hint={
              form.item_id
                ? `In ${itemsById.get(form.item_id)?.base_unit ?? "base units"} per serving.`
                : undefined
            }
          >
            <Input
              type="number"
              required
              min={0.0001}
              step={0.25}
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value })}
            />
          </Field>
          <Field label="Waste %" hint="Extra allowance for trim, spillage, and prep loss.">
            <Input
              type="number"
              required
              min={0}
              max={99}
              step={1}
              value={form.waste_pct}
              onChange={(e) => setForm({ ...form, waste_pct: e.target.value })}
            />
          </Field>
          <Field label="Applies to">
            <Select
              value={form.variant_id}
              onChange={(e) => setForm({ ...form, variant_id: e.target.value })}
            >
              <option value={ALL_VARIANTS}>All variants</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Switch
            checked={form.is_optional}
            onChange={(v) => setForm({ ...form, is_optional: v })}
            label="Optional ingredient"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Add ingredient
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Remove confirmation */}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={removeLine}
        title="Remove ingredient"
        message={`Remove ${removingItem?.name ?? "this ingredient"} from the recipe? Cost estimates update immediately.`}
        confirmLabel="Remove"
        loading={loading}
      />
    </Card>
  );
}
