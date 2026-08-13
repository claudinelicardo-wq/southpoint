"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Category, InventoryItem, Product } from "@/lib/catalog-types";
import { stockStatus } from "@/lib/catalog-types";
import { formatPeso, formatQty } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export function ProductsManager({
  categories,
  products,
  items,
  canManage,
  preview,
}: {
  categories: Category[];
  products: Product[];
  items: InventoryItem[];
  canManage: boolean;
  preview: boolean;
}) {
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Product | "new" | null>(null);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const filtered = products.filter((p) => {
    const item = p.inventory_item_id ? itemById.get(p.inventory_item_id) : undefined;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (item?.sku ?? "").toLowerCase().includes(q) ||
      (item?.barcode ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {preview && (
        <Alert tone="warning">Products need a connected Supabase project.</Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder="Search name, SKU, or barcode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {canManage && (
          <Button onClick={() => setDialog("new")} disabled={preview}>
            Add retail product
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={products.length === 0 ? "No retail products yet" : "No matches"}
          description={
            products.length === 0
              ? "Add bottled drinks, snacks, toiletries, and pickleball gear here."
              : "Try a different search."
          }
        />
      ) : (
        <Table>
          <THead>
            <TH>Product</TH>
            <TH>SKU / Barcode</TH>
            <TH>Price</TH>
            <TH>Cost</TH>
            <TH>Stock</TH>
            <TH>Status</TH>
            {canManage && <TH className="text-right">Actions</TH>}
          </THead>
          <TBody>
            {filtered.map((p) => {
              const item = p.inventory_item_id ? itemById.get(p.inventory_item_id) : undefined;
              const status = item ? stockStatus(item) : "out";
              return (
                <TR key={p.id}>
                  <TD className="font-medium">
                    {item ? (
                      <Link href={`/inventory/${item.id}`} className="hover:text-court-deep">
                        {p.name}
                      </Link>
                    ) : (
                      p.name
                    )}
                  </TD>
                  <TD className="text-latte">
                    {item?.sku ?? "—"}
                    {item?.barcode ? ` · ${item.barcode}` : ""}
                  </TD>
                  <TD>{formatPeso(p.price)}</TD>
                  <TD className="text-latte">{item ? formatPeso(item.avg_cost) : "—"}</TD>
                  <TD>{item ? formatQty(item.current_stock) : "—"}</TD>
                  <TD>
                    <Badge tone={status === "ok" ? "success" : status === "low" ? "warning" : "danger"}>
                      {status === "ok" ? "In stock" : status === "low" ? "Low stock" : "Out of stock"}
                    </Badge>
                  </TD>
                  {canManage && (
                    <TD className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDialog(p)}>
                        Edit
                      </Button>
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {dialog !== null && (
        <RetailDialog
          product={dialog === "new" ? null : dialog}
          categories={categories}
          items={items}
          itemById={itemById}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function RetailDialog({
  product,
  categories,
  items,
  itemById,
  onClose,
}: {
  product: Product | null;
  categories: Category[];
  items: InventoryItem[];
  itemById: Map<string, InventoryItem>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const linkedItem = product?.inventory_item_id
    ? itemById.get(product.inventory_item_id)
    : undefined;

  const retailCategories = categories.filter((c) => c.default_station === "none");
  const [form, setForm] = useState({
    name: product?.name ?? "",
    category_id: product?.category_id ?? (retailCategories[0] ?? categories[0])?.id ?? "",
    // Numeric fields are kept as strings while editing so the input can be
    // cleared to empty (Number("") coerces to 0, which made a controlled
    // input snap back to "0" and block typing a new value).
    price: product ? String(product.price) : "",
    sku: linkedItem?.sku ?? "",
    barcode: linkedItem?.barcode ?? "",
    reorder_level: linkedItem ? String(linkedItem.reorder_level) : "0",
    purchase_unit_label: linkedItem?.purchase_unit_label ?? "",
    purchase_to_base_factor: linkedItem ? String(linkedItem.purchase_to_base_factor) : "1",
    track_expiry: linkedItem?.track_expiry ?? false,
    // linking an existing stock item when creating
    existing_item_id: product?.inventory_item_id ?? "",
    // Opening stock — new products only. Without this, a newly created
    // product starts at 0 stock even if you're entering it because you just
    // bought/received it.
    opening_stock: "",
    opening_cost: "",
  });

  const linkableItems = items;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const price = Number(form.price) || 0;
    const reorderLevel = Number(form.reorder_level) || 0;
    const purchaseToBaseFactor = Number(form.purchase_to_base_factor) || 1;

    if (product) {
      const { error } = await supabase
        .from("products")
        .update({ name: form.name, category_id: form.category_id, price })
        .eq("id", product.id);
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      if (linkedItem) {
        const { error: itemError } = await supabase
          .from("inventory_items")
          .update({
            name: form.name,
            sku: form.sku || null,
            barcode: form.barcode || null,
            reorder_level: reorderLevel,
            purchase_unit_label: form.purchase_unit_label,
            purchase_to_base_factor: purchaseToBaseFactor,
            track_expiry: form.track_expiry,
          })
          .eq("id", linkedItem.id);
        if (itemError) {
          setError(itemError.message);
          setLoading(false);
          return;
        }
      }
    } else {
      let itemId = form.existing_item_id;
      if (!itemId) {
        const { data, error } = await supabase
          .from("inventory_items")
          .insert({
            name: form.name,
            sku: form.sku || null,
            barcode: form.barcode || null,
            inventory_type: "retail",
            category: "Retail",
            base_unit: "pc",
            purchase_unit_label: form.purchase_unit_label || "pc",
            purchase_to_base_factor: purchaseToBaseFactor,
            reorder_level: reorderLevel,
            track_expiry: form.track_expiry,
          })
          .select("id")
          .single();
        if (error || !data) {
          setError(error?.message ?? "Could not create the stock item.");
          setLoading(false);
          return;
        }
        itemId = data.id;
      }
      const { error } = await supabase.from("products").insert({
        kind: "retail",
        name: form.name,
        category_id: form.category_id,
        price,
        station: "none",
        inventory_item_id: itemId,
      });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      const openingStock = Number(form.opening_stock) || 0;
      if (openingStock > 0) {
        const { error: stockError } = await supabase.rpc("inventory_adjust", {
          p_item: itemId,
          p_qty_delta: openingStock,
          p_reason: "New product — opening stock",
          p_unit_cost: form.opening_cost !== "" ? Number(form.opening_cost) : null,
          p_movement_type: "opening_balance",
        });
        if (stockError) {
          setError(`Product created, but stock could not be added: ${stockError.message}`);
          setLoading(false);
          return;
        }
      }
    }

    setLoading(false);
    onClose();
    router.refresh();
  }

  async function archive() {
    if (!product) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("products")
      .update({ archived_at: new Date().toISOString(), is_available: false })
      .eq("id", product.id);
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={product ? `Edit ${product.name}` : "New retail product"}
      className="max-w-xl"
    >
      <form onSubmit={save} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Category">
            <Select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Selling price (₱)">
            <Input
              type="number"
              min="0"
              step="0.25"
              required
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Field>
          <Field label="Reorder level (pcs)">
            <Input
              type="number"
              min="0"
              value={form.reorder_level}
              onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
            />
          </Field>
          <Field label="SKU">
            <Input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </Field>
          <Field label="Barcode">
            <Input
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            />
          </Field>
          <Field label="Purchase unit" hint='e.g. "case of 24"'>
            <Input
              value={form.purchase_unit_label}
              onChange={(e) => setForm({ ...form, purchase_unit_label: e.target.value })}
            />
          </Field>
          <Field label="Units per purchase unit">
            <Input
              type="number"
              min="1"
              value={form.purchase_to_base_factor}
              onChange={(e) => setForm({ ...form, purchase_to_base_factor: e.target.value })}
            />
          </Field>
        </div>
        {!product && (
          <>
            <Field
              label="Link existing stock item (optional)"
              hint="Leave blank to create a new stock item automatically."
            >
              <Select
                value={form.existing_item_id}
                onChange={(e) => setForm({ ...form, existing_item_id: e.target.value })}
              >
                <option value="">Create new stock item</option>
                {linkableItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({formatQty(i.current_stock)} in stock)
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Opening stock"
                hint="How many you have on hand right now (e.g. what you just bought)."
              >
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.opening_stock}
                  onChange={(e) => setForm({ ...form, opening_stock: e.target.value })}
                />
              </Field>
              <Field
                label="Unit cost (₱)"
                hint="What you paid per unit. Leave blank to skip costing this batch."
              >
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.opening_cost}
                  onChange={(e) => setForm({ ...form, opening_cost: e.target.value })}
                />
              </Field>
            </div>
          </>
        )}
        <div className="flex items-center justify-between pt-1">
          {product ? (
            <Button variant="danger" size="sm" onClick={archive} disabled={loading}>
              Archive product
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {product ? "Save changes" : "Create product"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
