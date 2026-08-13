"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type {
  Category,
  InventoryItem,
  ModifierGroup,
  ModifierOption,
  ModifierOptionEffect,
  PrepStation,
  Product,
  ProductVariant,
} from "@/lib/catalog-types";
import { STATION_LABELS } from "@/lib/catalog-types";
import { formatPeso } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ModifierManager } from "./modifier-manager";

export function MenuManager(props: {
  categories: Category[];
  products: Product[];
  variants: ProductVariant[];
  groups: ModifierGroup[];
  options: ModifierOption[];
  effects: ModifierOptionEffect[];
  productGroups: { product_id: string; group_id: string }[];
  items: InventoryItem[];
  preview: boolean;
}) {
  const [tab, setTab] = useState<"items" | "modifiers">("items");

  return (
    <div className="space-y-4">
      {props.preview && (
        <Alert tone="warning">Menu management needs a connected Supabase project.</Alert>
      )}
      <div className="flex gap-1 rounded-xl bg-sand p-1 w-fit">
        {(["items", "modifiers"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-colors",
              tab === t ? "bg-paper text-espresso shadow-sm" : "text-latte hover:text-roast",
            )}
          >
            {t === "items" ? "Menu items" : "Modifiers"}
          </button>
        ))}
      </div>

      {tab === "items" ? (
        <MenuItems {...props} />
      ) : (
        <ModifierManager
          groups={props.groups}
          options={props.options}
          effects={props.effects}
          items={props.items}
          preview={props.preview}
        />
      )}
    </div>
  );
}

function MenuItems({
  categories,
  products,
  variants,
  groups,
  productGroups,
  preview,
}: {
  categories: Category[];
  products: Product[];
  variants: ProductVariant[];
  groups: ModifierGroup[];
  productGroups: { product_id: string; group_id: string }[];
  preview: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleAvailability(p: Product) {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("products")
      .update({ is_available: !p.is_available })
      .eq("id", p.id);
    if (error) setError(error.message);
    router.refresh();
  }

  if (products.length === 0 && !editing) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="No menu items yet"
          description="Add your first prepared item: drinks, meals, snacks. Retail goods live under Products."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAddingCategory(true)} disabled={preview}>
                New category
              </Button>
              <Button onClick={() => setEditing("new")} disabled={preview}>
                Add menu item
              </Button>
            </div>
          }
        />
        {editing !== null && (
          <ProductDialog
            product={editing === "new" ? null : editing}
            categories={categories}
            variants={variants}
            groups={groups}
            productGroups={productGroups}
            onClose={() => setEditing(null)}
          />
        )}
        {addingCategory && <CategoryDialog onClose={() => setAddingCategory(false)} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setAddingCategory(true)} disabled={preview}>
          New category
        </Button>
        <Button onClick={() => setEditing("new")} disabled={preview}>
          Add menu item
        </Button>
      </div>
      {categories
        .filter((c) => products.some((p) => p.category_id === c.id))
        .map((cat) => (
          <div key={cat.id}>
            <h2 className="mb-2 font-display text-lg font-semibold text-espresso">
              {cat.name}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {products
                .filter((p) => p.category_id === cat.id)
                .map((p) => {
                  const pVariants = variants.filter((v) => v.product_id === p.id);
                  return (
                    <div
                      key={p.id}
                      className="rounded-(--radius-card) border border-line bg-paper p-4 shadow-(--shadow-card)"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-espresso">{p.name}</p>
                          <p className="text-sm text-latte">
                            {formatPeso(p.price)}
                            {pVariants.length > 0 &&
                              ` · ${pVariants.map((v) => v.name).join(" / ")}`}
                          </p>
                        </div>
                        <Badge tone={p.station === "bar" ? "info" : p.station === "kitchen" ? "accent" : "neutral"}>
                          {STATION_LABELS[p.station]}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <Switch
                          checked={p.is_available}
                          onChange={() => toggleAvailability(p)}
                          label={p.is_available ? "Available" : "Unavailable"}
                        />
                        <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                          Edit
                        </Button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      {editing !== null && (
        <ProductDialog
          product={editing === "new" ? null : editing}
          categories={categories}
          variants={variants}
          groups={groups}
          productGroups={productGroups}
          onClose={() => setEditing(null)}
        />
      )}
      {addingCategory && <CategoryDialog onClose={() => setAddingCategory(false)} />}
    </div>
  );
}

function CategoryDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [station, setStation] = useState<PrepStation>("kitchen");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("categories")
      .insert({ name: name.trim(), default_station: station });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onClose={onClose} title="New category">
      <form onSubmit={save} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name">
          <Input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pastries"
          />
        </Field>
        <Field label="Default preparation station" hint="Applied to new items in this category; each item can still override it.">
          <Select value={station} onChange={(e) => setStation(e.target.value as PrepStation)}>
            <option value="bar">Bar</option>
            <option value="kitchen">Kitchen</option>
            <option value="none">No preparation</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Create category
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ProductDialog({
  product,
  categories,
  variants,
  groups,
  productGroups,
  onClose,
}: {
  product: Product | null;
  categories: Category[];
  variants: ProductVariant[];
  groups: ModifierGroup[];
  productGroups: { product_id: string; group_id: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: product?.name ?? "",
    category_id: product?.category_id ?? categories[0]?.id ?? "",
    // Kept as strings while editing so the input can be cleared to empty —
    // Number("") coerces to 0, which made a controlled input snap back to
    // "0" and block typing a new value.
    price: product ? String(product.price) : "",
    station: (product?.station ?? "bar") as PrepStation,
    prep_minutes: product ? String(product.prep_minutes) : "5",
    tax_exempt: product?.tax_exempt ?? false,
  });
  const [variantText, setVariantText] = useState(
    product
      ? variants
          .filter((v) => v.product_id === product.id)
          .map((v) => `${v.name}${v.price_delta ? `:+${v.price_delta}` : ""}`)
          .join(", ")
      : "",
  );
  const [selectedGroups, setSelectedGroups] = useState<string[]>(
    product ? productGroups.filter((pg) => pg.product_id === product.id).map((pg) => pg.group_id) : [],
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    let productId = product?.id;
    const payload = {
      ...form,
      price: Number(form.price) || 0,
      prep_minutes: Number(form.prep_minutes) || 0,
    };

    if (product) {
      const { error } = await supabase.from("products").update(payload).eq("id", product.id);
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("products")
        .insert({ ...payload, kind: "prepared" })
        .select("id")
        .single();
      if (error || !data) {
        setError(error?.message ?? "Insert failed");
        setLoading(false);
        return;
      }
      productId = data.id;
    }

    // Variants: parse "Hot, Iced:+10" syntax. Replace existing set.
    const parsed = variantText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s, i) => {
        const [name, delta] = s.split(":");
        return {
          product_id: productId,
          name: name.trim(),
          price_delta: delta ? Number(delta.replace("+", "")) || 0 : 0,
          is_default: i === 0,
          sort_order: i + 1,
        };
      });
    const existing = variants.filter((v) => v.product_id === productId);
    // Only rewrite when the definition changed, to avoid orphaning recipe lines.
    const changed =
      parsed.length !== existing.length ||
      parsed.some(
        (pv, i) => pv.name !== existing[i]?.name || pv.price_delta !== Number(existing[i]?.price_delta),
      );
    if (changed) {
      const del = await supabase.from("product_variants").delete().eq("product_id", productId!);
      if (del.error) {
        setError(`Variants: ${del.error.message}`);
        setLoading(false);
        return;
      }
      if (parsed.length > 0) {
        const ins = await supabase.from("product_variants").insert(parsed);
        if (ins.error) {
          setError(`Variants: ${ins.error.message}`);
          setLoading(false);
          return;
        }
      }
    }

    // Modifier groups: replace set.
    await supabase.from("product_modifier_groups").delete().eq("product_id", productId!);
    if (selectedGroups.length > 0) {
      const ins = await supabase.from("product_modifier_groups").insert(
        selectedGroups.map((g, i) => ({ product_id: productId, group_id: g, sort_order: i })),
      );
      if (ins.error) {
        setError(`Modifiers: ${ins.error.message}`);
        setLoading(false);
        return;
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
      title={product ? `Edit ${product.name}` : "New menu item"}
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
          <Field label="Price (₱)">
            <Input
              type="number"
              min="0"
              step="0.25"
              required
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Field>
          <Field label="Preparation station">
            <Select
              value={form.station}
              onChange={(e) => setForm({ ...form, station: e.target.value as PrepStation })}
            >
              <option value="bar">Bar</option>
              <option value="kitchen">Kitchen</option>
              <option value="none">No preparation</option>
            </Select>
          </Field>
          <Field label="Prep time (minutes)">
            <Input
              type="number"
              min="0"
              value={form.prep_minutes}
              onChange={(e) => setForm({ ...form, prep_minutes: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Variants"
          hint='Comma-separated. Add price with a colon: "Hot, Iced:+10". Changing variants resets variant-specific recipe lines.'
        >
          <Input
            value={variantText}
            onChange={(e) => setVariantText(e.target.value)}
            placeholder="Hot, Iced:+10"
          />
        </Field>
        <Field label="Modifier groups">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const active = selectedGroups.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    setSelectedGroups(
                      active
                        ? selectedGroups.filter((id) => id !== g.id)
                        : [...selectedGroups, g.id],
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    active
                      ? "border-court bg-court-soft text-court-deep"
                      : "border-line text-latte hover:border-latte",
                  )}
                >
                  {g.name}
                </button>
              );
            })}
            {groups.length === 0 && (
              <span className="text-sm text-latte">No modifier groups yet. Create them in the Modifiers tab.</span>
            )}
          </div>
        </Field>
        <Switch
          checked={form.tax_exempt}
          onChange={(v) => setForm({ ...form, tax_exempt: v })}
          label="Tax-exempt item"
        />
        <div className="flex items-center justify-between pt-1">
          {product ? (
            <Button variant="danger" size="sm" onClick={archive} disabled={loading}>
              Archive item
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {product ? "Save changes" : "Create item"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
