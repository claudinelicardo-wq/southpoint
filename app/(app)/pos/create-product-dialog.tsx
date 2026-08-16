"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import type { Category, Product } from "@/lib/catalog-types";
import { formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface ExternalSuggestion {
  productName: string | null;
  brand: string | null;
  packageSize: string | null;
  imageUrl: string | null;
  source: string;
}

/**
 * Create a retail product for a barcode the catalog doesn't know, right from
 * the POS scan flow. On open it asks the server to identify the barcode via
 * external product databases and prefills the name as a suggestion — price,
 * cost, and stock always come from staff. Saving adds the product to the
 * cart so the sale in progress isn't interrupted.
 */
export function CreateProductDialog({
  barcode,
  categories,
  onCreated,
  onClose,
}: {
  barcode: string;
  categories: Category[];
  onCreated: (product: Product) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const retailCategories = categories.filter((c) => c.default_station === "none");
  const [suggestion, setSuggestion] = useState<ExternalSuggestion | null>(null);
  const [looking, setLooking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category_id: (retailCategories[0] ?? categories[0])?.id ?? "",
    price: "",
    opening_stock: "",
    opening_cost: "",
  });

  // Identify the barcode externally once, on open. A miss or a lookup
  // failure both just mean "no prefill" — creation always stays possible.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/product-lookup/${encodeURIComponent(barcode)}`);
        const json = (await res.json().catch(() => null)) as {
          found?: boolean;
          product?: ExternalSuggestion;
        } | null;
        if (cancelled || !json?.found || !json.product) return;
        setSuggestion(json.product);
        const suggestedName = [json.product.brand, json.product.productName]
          .filter(Boolean)
          .join(" ")
          .concat(json.product.packageSize ? ` (${json.product.packageSize})` : "");
        setForm((f) => (f.name === "" ? { ...f, name: suggestedName } : f));
      } catch {
        // offline or provider down — manual entry continues
      } finally {
        if (!cancelled) setLooking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [barcode]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0) {
      setError("Enter a selling price greater than zero.");
      return;
    }
    setSaving(true);
    const supabase = createClient();

    const { data: item, error: itemError } = await supabase
      .from("inventory_items")
      .insert({
        name: form.name.trim(),
        barcode,
        inventory_type: "retail",
        category: "Retail",
        base_unit: "pc",
        purchase_unit_label: "pc",
        purchase_to_base_factor: 1,
      })
      .select("id")
      .single();
    if (itemError || !item) {
      setSaving(false);
      setError(
        itemError?.message.includes("duplicate")
          ? "This barcode is already assigned to another item — search for it instead."
          : (itemError?.message ?? "Could not create the item."),
      );
      return;
    }

    const { data: product, error: productError } = await supabase
      .from("products")
      .insert({
        kind: "retail",
        name: form.name.trim(),
        category_id: form.category_id,
        price,
        station: "none",
        inventory_item_id: item.id,
      })
      .select("*")
      .single();
    if (productError || !product) {
      setSaving(false);
      setError(productError?.message ?? "Could not create the product.");
      return;
    }

    const openingStock = Number(form.opening_stock) || 0;
    if (openingStock > 0) {
      const { error: stockError } = await supabase.rpc("inventory_adjust", {
        p_item: item.id,
        p_qty_delta: openingStock,
        p_reason: "New product — opening stock (created at POS from scan)",
        p_unit_cost: form.opening_cost !== "" ? Number(form.opening_cost) : null,
        p_movement_type: "opening_balance",
      });
      if (stockError) {
        setSaving(false);
        setError(`Product created, but stock could not be added: ${stockError.message}`);
        return;
      }
    }

    setSaving(false);
    onCreated(product as Product);
    router.refresh();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add new product"
      description={`Barcode ${barcode} isn't in the catalog yet.`}
      className="max-w-xl"
    >
      <form onSubmit={save} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {looking ? (
          <p className="rounded-lg bg-cream px-3 py-2 text-sm text-latte">
            Looking up this barcode in product databases…
          </p>
        ) : suggestion ? (
          <div className="flex items-center gap-3 rounded-lg bg-cream p-3">
            {suggestion.imageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- external preview only, never stored */
              <img
                src={suggestion.imageUrl}
                alt=""
                className="h-14 w-14 rounded-lg border border-line bg-white object-contain"
              />
            )}
            <p className="text-sm text-roast">
              Identified as{" "}
              <span className="font-medium text-espresso">
                {[suggestion.brand, suggestion.productName].filter(Boolean).join(" ")}
                {suggestion.packageSize ? ` (${suggestion.packageSize})` : ""}
              </span>
              <span className="block text-xs text-latte">
                Suggestion from {suggestion.source} — you set the price, cost, and stock.
              </span>
            </p>
          </div>
        ) : (
          <p className="rounded-lg bg-cream px-3 py-2 text-sm text-latte">
            Not found in external product databases — enter the details manually.
          </p>
        )}

        <Field label="Product name">
          <Input
            required
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="Stock on hand">
            <Input
              type="number"
              min="0"
              step="1"
              value={form.opening_stock}
              onChange={(e) => setForm({ ...form, opening_stock: e.target.value })}
            />
          </Field>
          <Field label="Unit cost (₱)" hint="What you paid each. Optional.">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.opening_cost}
              onChange={(e) => setForm({ ...form, opening_cost: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {form.price ? `Save & add to cart · ${formatPeso(Number(form.price) || 0)}` : "Save & add to cart"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
