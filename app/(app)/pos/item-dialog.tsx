"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import type {
  ModifierGroup,
  ModifierOption,
  Product,
  ProductVariant,
} from "@/lib/catalog-types";
import { formatPeso } from "@/lib/format";
import { useMemo, useState } from "react";
import type { CartItem } from "./pos-types";

/** Variant + modifier picker shown when a product needs configuration. */
export function ItemDialog({
  product,
  variants,
  groups,
  options,
  onAdd,
  onClose,
}: {
  product: Product;
  variants: ProductVariant[];
  groups: ModifierGroup[];
  options: ModifierOption[];
  onAdd: (item: CartItem) => void;
  onClose: () => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(
    variants.find((v) => v.is_default)?.id ?? variants[0]?.id ?? null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);

  const optionsByGroup = useMemo(() => {
    const m = new Map<string, ModifierOption[]>();
    for (const o of options) {
      const list = m.get(o.group_id) ?? [];
      list.push(o);
      m.set(o.group_id, list);
    }
    return m;
  }, [options]);

  function toggleOption(group: ModifierGroup, option: ModifierOption) {
    setSelected((prev) => {
      const next = new Set(prev);
      const groupOptions = (optionsByGroup.get(group.id) ?? []).map((o) => o.id);
      if (next.has(option.id)) {
        next.delete(option.id);
        return next;
      }
      if (group.selection === "single") {
        for (const id of groupOptions) next.delete(id);
        next.add(option.id);
      } else {
        const chosen = groupOptions.filter((id) => next.has(id)).length;
        if (chosen >= group.max_select) return prev; // at limit
        next.add(option.id);
      }
      return next;
    });
  }

  const variant = variants.find((v) => v.id === variantId) ?? null;
  const chosenOptions = options.filter((o) => selected.has(o.id));
  const unitPrice = Number(product.price) + Number(variant?.price_delta ?? 0);
  const modPrice = chosenOptions.reduce((s, o) => s + Number(o.price_delta), 0);

  const missingRequired = groups.some(
    (g) =>
      g.is_required &&
      !(optionsByGroup.get(g.id) ?? []).some((o) => selected.has(o.id)),
  );

  function add() {
    onAdd({
      key: crypto.randomUUID(),
      product_id: product.id,
      name: product.name,
      kind: product.kind,
      variant_id: variant?.id ?? null,
      variant_name: variant?.name ?? null,
      qty,
      unit_price: unitPrice,
      mod_price: modPrice,
      modifier_option_ids: chosenOptions.map((o) => o.id),
      modifier_names: chosenOptions.map(
        (o) => o.name + (Number(o.price_delta) !== 0 ? ` +${Number(o.price_delta)}` : ""),
      ),
      notes: "",
    });
  }

  return (
    <Dialog open onClose={onClose} title={product.name} className="max-w-xl">
      <div className="space-y-5">
        {variants.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-roast">Variant</p>
            <div className="flex flex-wrap gap-2">
              {variants.map((v) => (
                <button
                  key={v.id}
                  disabled={!v.is_available}
                  onClick={() => setVariantId(v.id)}
                  className={cn(
                    "min-h-11 rounded-xl border px-4 text-sm font-medium transition-colors",
                    variantId === v.id
                      ? "border-court bg-court-soft text-court-deep"
                      : "border-line bg-paper text-roast hover:border-latte",
                    !v.is_available && "cursor-not-allowed opacity-50",
                  )}
                >
                  {v.name}
                  {Number(v.price_delta) !== 0 && (
                    <span className="ml-1 text-xs text-latte">
                      +{formatPeso(v.price_delta)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.id}>
            <p className="mb-2 text-sm font-medium text-roast">
              {g.name}
              {g.is_required ? (
                <span className="ml-1 text-xs text-danger">required</span>
              ) : (
                <span className="ml-1 text-xs text-latte">
                  {g.selection === "multi" ? `up to ${g.max_select}` : "optional"}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {(optionsByGroup.get(g.id) ?? []).map((o) => (
                <button
                  key={o.id}
                  disabled={!o.is_available}
                  onClick={() => toggleOption(g, o)}
                  className={cn(
                    "min-h-11 rounded-xl border px-4 text-sm font-medium transition-colors",
                    selected.has(o.id)
                      ? "border-court bg-court-soft text-court-deep"
                      : "border-line bg-paper text-roast hover:border-latte",
                    !o.is_available && "cursor-not-allowed opacity-50",
                  )}
                >
                  {o.name}
                  {Number(o.price_delta) !== 0 && (
                    <span className="ml-1 text-xs text-latte">
                      +{formatPeso(o.price_delta)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQty(Math.max(1, qty - 1))}
              className="grid size-11 place-items-center rounded-xl bg-sand text-xl font-bold text-roast active:scale-95"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-8 text-center text-lg font-semibold">{qty}</span>
            <button
              onClick={() => setQty(qty + 1)}
              className="grid size-11 place-items-center rounded-xl bg-sand text-xl font-bold text-roast active:scale-95"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
          <Button size="lg" onClick={add} disabled={missingRequired}>
            Add {qty > 1 ? `${qty} × ` : ""}
            {formatPeso(qty * (unitPrice + modPrice))}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
