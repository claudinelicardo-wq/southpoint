"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { InventoryItem, InventoryType } from "@/lib/catalog-types";
import { INVENTORY_TYPE_LABELS, stockStatus } from "@/lib/catalog-types";
import { formatPeso, formatQty } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const BASE_UNITS = ["g", "kg", "ml", "l", "pc", "serving"] as const;
const INVENTORY_TYPES = Object.keys(INVENTORY_TYPE_LABELS) as InventoryType[];

const STOCK_BADGES = {
  out: { tone: "danger", label: "Out of stock" },
  low: { tone: "warning", label: "Low stock" },
  ok: { tone: "success", label: "In stock" },
} as const;

interface ItemForm {
  name: string;
  sku: string;
  barcode: string;
  inventory_type: InventoryType;
  category: string;
  base_unit: string;
  purchase_unit_label: string;
  purchase_to_base_factor: number;
  reorder_level: number;
  target_level: number;
  storage_location: string;
  track_expiry: boolean;
}

const EMPTY_FORM: ItemForm = {
  name: "",
  sku: "",
  barcode: "",
  inventory_type: "ingredient",
  category: "",
  base_unit: "g",
  purchase_unit_label: "",
  purchase_to_base_factor: 1,
  reorder_level: 0,
  target_level: 0,
  storage_location: "",
  track_expiry: false,
};

export function InventoryManager({
  items,
  canAdjust,
  preview,
}: {
  items: InventoryItem[];
  canAdjust: boolean;
  preview: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | InventoryType>("all");

  // New/Edit item dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Adjust stock dialog state
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [adjust, setAdjust] = useState({
    qty_delta: "",
    reason: "",
    notes: "",
    unit_cost: "",
    expires: "",
  });
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustingBusy, setAdjustingBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== "all" && item.inventory_type !== typeFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        (item.sku ?? "").toLowerCase().includes(q) ||
        (item.barcode ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, typeFilter]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(item: InventoryItem) {
    setEditing(item);
    setForm({
      name: item.name,
      sku: item.sku ?? "",
      barcode: item.barcode ?? "",
      inventory_type: item.inventory_type,
      category: item.category,
      base_unit: item.base_unit,
      purchase_unit_label: item.purchase_unit_label,
      purchase_to_base_factor: Number(item.purchase_to_base_factor),
      reorder_level: Number(item.reorder_level),
      target_level: Number(item.target_level),
      storage_location: item.storage_location,
      track_expiry: item.track_expiry,
    });
    setFormError(null);
    setFormOpen(true);
  }

  function openAdjust(item: InventoryItem) {
    setAdjusting(item);
    setAdjust({ qty_delta: "", reason: "", notes: "", unit_cost: "", expires: "" });
    setAdjustError(null);
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const supabase = createClient();

    // Metadata only — stock and cost columns are managed by the ledger functions.
    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      inventory_type: form.inventory_type,
      category: form.category.trim(),
      purchase_unit_label: form.purchase_unit_label.trim(),
      purchase_to_base_factor: form.purchase_to_base_factor,
      reorder_level: form.reorder_level,
      target_level: form.target_level,
      storage_location: form.storage_location.trim(),
      track_expiry: form.track_expiry,
    };

    const { error } = editing
      ? await supabase.from("inventory_items").update(payload).eq("id", editing.id)
      : await supabase
          .from("inventory_items")
          .insert({ ...payload, base_unit: form.base_unit });

    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setFormOpen(false);
    router.refresh();
  }

  async function saveAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjusting) return;

    const delta = Number(adjust.qty_delta);
    if (!Number.isFinite(delta) || delta === 0) {
      setAdjustError("Enter a nonzero quantity. Positive receives, negative deducts.");
      return;
    }

    setAdjustingBusy(true);
    setAdjustError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("inventory_adjust", {
      p_item: adjusting.id,
      p_qty_delta: delta,
      p_reason: adjust.reason,
      p_notes: adjust.notes.trim() || null,
      p_unit_cost:
        delta > 0 && adjust.unit_cost !== "" ? Number(adjust.unit_cost) : null,
      p_expires:
        delta > 0 && adjusting.track_expiry && adjust.expires ? adjust.expires : null,
    });
    setAdjustingBusy(false);
    if (error) {
      setAdjustError(error.message);
      return;
    }
    setAdjusting(null);
    router.refresh();
  }

  const adjustDelta = Number(adjust.qty_delta);
  const showReceiveFields = Number.isFinite(adjustDelta) && adjustDelta > 0;

  return (
    <div className="space-y-4">
      {preview && (
        <Alert tone="warning">
          Inventory needs a connected Supabase project.
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search by name, SKU, or barcode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          aria-label="Search inventory"
        />
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "all" | InventoryType)}
          className="w-auto"
          aria-label="Filter by type"
        >
          <option value="all">All types</option>
          {INVENTORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {INVENTORY_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        {canAdjust && (
          <div className="ml-auto">
            <Button onClick={openNew} disabled={preview}>
              New item
            </Button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No inventory items yet"
          description="Add ingredients, packaging, and retail stock to start tracking quantities and costs."
          action={
            canAdjust ? (
              <Button onClick={openNew} disabled={preview}>
                New item
              </Button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No matching items"
          description="Try a different search term or type filter."
        />
      ) : (
        <Table>
          <THead>
            <TH>Name</TH>
            <TH>Type</TH>
            <TH>Stock</TH>
            <TH>Avg cost</TH>
            <TH>Reorder level</TH>
            {canAdjust && <TH className="text-right">Actions</TH>}
          </THead>
          <TBody>
            {filtered.map((item) => {
              const status = stockStatus(item);
              const badge = STOCK_BADGES[status];
              return (
                <TR key={item.id}>
                  <TD className="font-medium">
                    <Link
                      href={`/inventory/${item.id}`}
                      className="text-espresso underline-offset-2 hover:underline"
                    >
                      {item.name}
                    </Link>
                    {item.sku && (
                      <span className="ml-2 text-xs text-latte">{item.sku}</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone="neutral">
                      {INVENTORY_TYPE_LABELS[item.inventory_type]}
                    </Badge>
                  </TD>
                  <TD>
                    <span className="mr-2 text-espresso">
                      {formatQty(item.current_stock)} {item.base_unit}
                    </span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </TD>
                  <TD className="text-latte">
                    {formatPeso(item.avg_cost)} / {item.base_unit}
                  </TD>
                  <TD className="text-latte">
                    {formatQty(item.reorder_level)} {item.base_unit}
                  </TD>
                  {canAdjust && (
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(item)}
                        disabled={preview}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openAdjust(item)}
                        disabled={preview}
                      >
                        Adjust
                      </Button>
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {/* New / Edit item dialog */}
      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : "New inventory item"}
        description={
          editing
            ? undefined
            : "Stock starts at zero. Receive quantities with an adjustment or purchase."
        }
      >
        <form onSubmit={saveItem} className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
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
            <Field label="Type">
              <Select
                value={form.inventory_type}
                onChange={(e) =>
                  setForm({ ...form, inventory_type: e.target.value as InventoryType })
                }
              >
                {INVENTORY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {INVENTORY_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category" hint="Free-text grouping, e.g. Dairy">
              <Input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </Field>
            <Field
              label="Base unit"
              hint={
                editing
                  ? "Cannot change after creation."
                  : "The unit stock is counted in. Cannot change later."
              }
            >
              <Select
                value={form.base_unit}
                disabled={editing !== null}
                onChange={(e) => setForm({ ...form, base_unit: e.target.value })}
              >
                {BASE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Purchase unit label" hint="e.g. 1L carton">
              <Input
                value={form.purchase_unit_label}
                onChange={(e) =>
                  setForm({ ...form, purchase_unit_label: e.target.value })
                }
              />
            </Field>
            <Field
              label="Purchase-to-base factor"
              hint="Base units per purchase unit, e.g. 1000"
            >
              <Input
                type="number"
                step="any"
                min="0.000001"
                required
                value={form.purchase_to_base_factor}
                onChange={(e) =>
                  setForm({ ...form, purchase_to_base_factor: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Storage location" hint="e.g. Walk-in chiller">
              <Input
                value={form.storage_location}
                onChange={(e) =>
                  setForm({ ...form, storage_location: e.target.value })
                }
              />
            </Field>
            <Field label="Reorder level" hint="In base units. 0 disables the alert.">
              <Input
                type="number"
                step="any"
                min="0"
                value={form.reorder_level}
                onChange={(e) =>
                  setForm({ ...form, reorder_level: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Target level" hint="Restock up to this quantity.">
              <Input
                type="number"
                step="any"
                min="0"
                value={form.target_level}
                onChange={(e) =>
                  setForm({ ...form, target_level: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <Switch
            checked={form.track_expiry}
            onChange={(v) => setForm({ ...form, track_expiry: v })}
            label="Track expiry dates on received batches"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save changes" : "Create item"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Adjust stock dialog */}
      <Dialog
        open={adjusting !== null}
        onClose={() => setAdjusting(null)}
        title={`Adjust ${adjusting?.name ?? "stock"}`}
        description={
          adjusting
            ? `Current stock: ${formatQty(adjusting.current_stock)} ${adjusting.base_unit}. Positive quantities receive stock; negative quantities deduct.`
            : undefined
        }
      >
        <form onSubmit={saveAdjustment} className="space-y-4">
          {adjustError && <Alert tone="danger">{adjustError}</Alert>}
          <Field
            label={`Quantity change (${adjusting?.base_unit ?? "base units"})`}
            hint="e.g. 500 to receive, -500 to deduct"
          >
            <Input
              type="number"
              step="any"
              required
              value={adjust.qty_delta}
              onChange={(e) => setAdjust({ ...adjust, qty_delta: e.target.value })}
            />
          </Field>
          <Field label="Reason" hint="Required; recorded in the movement ledger.">
            <Input
              required
              value={adjust.reason}
              onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
              placeholder="e.g. physical count correction"
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={adjust.notes}
              onChange={(e) => setAdjust({ ...adjust, notes: e.target.value })}
            />
          </Field>
          {showReceiveFields && (
            <Field
              label={`Unit cost (₱ per ${adjusting?.base_unit ?? "unit"})`}
              hint="Leave blank to use the item's average cost."
            >
              <Input
                type="number"
                step="any"
                min="0"
                value={adjust.unit_cost}
                onChange={(e) => setAdjust({ ...adjust, unit_cost: e.target.value })}
              />
            </Field>
          )}
          {showReceiveFields && adjusting?.track_expiry && (
            <Field label="Expiry date" hint="Optional; applies to the received batch.">
              <Input
                type="date"
                value={adjust.expires}
                onChange={(e) => setAdjust({ ...adjust, expires: e.target.value })}
              />
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setAdjusting(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={adjustingBusy}>
              Apply adjustment
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
