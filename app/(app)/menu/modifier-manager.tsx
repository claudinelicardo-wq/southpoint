"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { formatPeso, formatQty } from "@/lib/format";
import type {
  InventoryItem,
  ModifierGroup,
  ModifierOption,
  ModifierOptionEffect,
} from "@/lib/catalog-types";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ModifierManager({
  groups,
  options,
  effects,
  items,
  preview,
}: {
  groups: ModifierGroup[];
  options: ModifierOption[];
  effects: ModifierOptionEffect[];
  items: InventoryItem[];
  preview: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<ModifierGroup | "new" | null>(null);
  const [optionDialog, setOptionDialog] = useState<
    { group: ModifierGroup; option: ModifierOption | null } | null
  >(null);

  const itemName = (id: string | null) =>
    items.find((i) => i.id === id)?.name ?? "unknown item";

  async function toggleOption(o: ModifierOption) {
    const supabase = createClient();
    const { error } = await supabase
      .from("modifier_options")
      .update({ is_available: !o.is_available })
      .eq("id", o.id);
    if (error) setError(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex justify-end">
        <Button onClick={() => setGroupDialog("new")} disabled={preview}>
          Add modifier group
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="No modifier groups yet"
          description="Modifier groups let customers customize items: milk choice, extra shots, sugar level."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <div
              key={g.id}
              className="rounded-(--radius-card) border border-line bg-paper p-4 shadow-(--shadow-card)"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-espresso">{g.name}</p>
                  <p className="text-xs text-latte">
                    {g.selection === "single" ? "Choose one" : `Choose up to ${g.max_select}`}
                    {g.is_required && " · required"}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setGroupDialog(g)}>
                  Edit
                </Button>
              </div>
              <ul className="mt-3 space-y-2">
                {options
                  .filter((o) => o.group_id === g.id)
                  .map((o) => {
                    const fx = effects.filter((e) => e.option_id === o.id);
                    return (
                      <li
                        key={o.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-cream px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-roast">
                            {o.name}
                            {Number(o.price_delta) !== 0 && (
                              <span className="ml-1 text-latte">
                                +{formatPeso(o.price_delta)}
                              </span>
                            )}
                          </p>
                          {fx.length > 0 && (
                            <p className="truncate text-xs text-latte">
                              {fx
                                .map((e) => {
                                  if (e.add_item_id && e.remove_item_id)
                                    return `${itemName(e.remove_item_id)} → ${itemName(e.add_item_id)} (${formatQty(e.add_qty ?? 0)})`;
                                  if (e.add_item_id)
                                    return `+${formatQty(e.add_qty ?? 0)} ${itemName(e.add_item_id)}`;
                                  return `−${formatQty(e.remove_qty ?? 0)} ${itemName(e.remove_item_id)}`;
                                })
                                .join(", ")}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {!o.is_available && <Badge tone="danger">86’d</Badge>}
                          <Button variant="ghost" size="sm" onClick={() => toggleOption(o)}>
                            {o.is_available ? "86" : "Restore"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOptionDialog({ group: g, option: o })}
                          >
                            Edit
                          </Button>
                        </div>
                      </li>
                    );
                  })}
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setOptionDialog({ group: g, option: null })}
              >
                Add option
              </Button>
            </div>
          ))}
        </div>
      )}

      {groupDialog !== null && (
        <GroupDialog
          group={groupDialog === "new" ? null : groupDialog}
          onClose={() => setGroupDialog(null)}
        />
      )}
      {optionDialog !== null && (
        <OptionDialog
          group={optionDialog.group}
          option={optionDialog.option}
          effects={effects}
          items={items}
          onClose={() => setOptionDialog(null)}
        />
      )}
    </div>
  );
}

function GroupDialog({
  group,
  onClose,
}: {
  group: ModifierGroup | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    selection: "single" | "multi";
    is_required: boolean;
    // Kept as a string while editing — Number("") coercing to 0 on every
    // keystroke made the field snap back to "0" and block typing.
    max_select: string;
  }>({
    name: group?.name ?? "",
    selection: group?.selection ?? "single",
    is_required: group?.is_required ?? false,
    max_select: String(group?.max_select ?? 1),
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      ...form,
      min_select: form.is_required ? 1 : 0,
      max_select: form.selection === "single" ? 1 : Math.max(1, Number(form.max_select) || 1),
    };
    const { error } = group
      ? await supabase.from("modifier_groups").update(payload).eq("id", group.id)
      : await supabase.from("modifier_groups").insert(payload);
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onClose={onClose} title={group ? `Edit ${group.name}` : "New modifier group"}>
      <form onSubmit={save} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name">
          <Input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Milk Choice"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Selection">
            <Select
              value={form.selection}
              onChange={(e) =>
                setForm({ ...form, selection: e.target.value as "single" | "multi" })
              }
            >
              <option value="single">Choose one</option>
              <option value="multi">Choose multiple</option>
            </Select>
          </Field>
          {form.selection === "multi" && (
            <Field label="Max selections">
              <Input
                type="number"
                min="1"
                max="10"
                value={form.max_select}
                onChange={(e) => setForm({ ...form, max_select: e.target.value })}
              />
            </Field>
          )}
        </div>
        <Switch
          checked={form.is_required}
          onChange={(v) => setForm({ ...form, is_required: v })}
          label="Selection required"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {group ? "Save" : "Create group"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function OptionDialog({
  group,
  option,
  effects,
  items,
  onClose,
}: {
  group: ModifierGroup;
  option: ModifierOption | null;
  effects: ModifierOptionEffect[];
  items: InventoryItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const existingEffect = option ? effects.find((e) => e.option_id === option.id) ?? null : null;
  const [form, setForm] = useState({
    name: option?.name ?? "",
    // Kept as a string while editing — Number("") coercing to 0 on every
    // keystroke made the field snap back to "0" and block typing.
    price_delta: String(option?.price_delta ?? 0),
  });
  const [effectKind, setEffectKind] = useState<"none" | "add" | "remove" | "replace">(
    existingEffect
      ? existingEffect.add_item_id && existingEffect.remove_item_id
        ? "replace"
        : existingEffect.add_item_id
          ? "add"
          : "remove"
      : "none",
  );
  const [fx, setFx] = useState({
    add_item_id: existingEffect?.add_item_id ?? "",
    add_qty: String(existingEffect?.add_qty ?? 0),
    remove_item_id: existingEffect?.remove_item_id ?? "",
    remove_qty: String(existingEffect?.remove_qty ?? 0),
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    let optionId = option?.id;
    const payload0 = { ...form, price_delta: Number(form.price_delta) || 0 };

    if (option) {
      const { error } = await supabase
        .from("modifier_options")
        .update(payload0)
        .eq("id", option.id);
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("modifier_options")
        .insert({ ...payload0, group_id: group.id })
        .select("id")
        .single();
      if (error || !data) {
        setError(error?.message ?? "Insert failed");
        setLoading(false);
        return;
      }
      optionId = data.id;
    }

    // Replace the inventory effect definition.
    if (existingEffect) {
      const del = await supabase
        .from("modifier_option_effects")
        .delete()
        .eq("id", existingEffect.id);
      if (del.error) {
        setError(del.error.message);
        setLoading(false);
        return;
      }
    }
    if (effectKind !== "none") {
      const payload = {
        option_id: optionId,
        add_item_id: effectKind !== "remove" ? fx.add_item_id || null : null,
        add_qty: effectKind !== "remove" && fx.add_item_id ? Number(fx.add_qty) || 0 : null,
        remove_item_id: effectKind !== "add" ? fx.remove_item_id || null : null,
        remove_qty: effectKind !== "add" && fx.remove_item_id ? Number(fx.remove_qty) || 0 : null,
      };
      const ins = await supabase.from("modifier_option_effects").insert(payload);
      if (ins.error) {
        setError(`Inventory effect: ${ins.error.message}`);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    onClose();
    router.refresh();
  }

  const itemOptions = items.map((i) => (
    <option key={i.id} value={i.id}>
      {i.name} ({i.base_unit})
    </option>
  ));

  return (
    <Dialog
      open
      onClose={onClose}
      title={option ? `Edit ${option.name}` : `New option in ${group.name}`}
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
              placeholder="Oat Milk"
            />
          </Field>
          <Field label="Price change (₱)">
            <Input
              type="number"
              step="0.25"
              value={form.price_delta}
              onChange={(e) => setForm({ ...form, price_delta: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Inventory effect"
          hint="How choosing this option changes ingredient deduction."
        >
          <Select
            value={effectKind}
            onChange={(e) => setEffectKind(e.target.value as typeof effectKind)}
          >
            <option value="none">No inventory effect</option>
            <option value="add">Adds an ingredient</option>
            <option value="remove">Removes an ingredient</option>
            <option value="replace">Replaces an ingredient</option>
          </Select>
        </Field>
        {(effectKind === "remove" || effectKind === "replace") && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Removes item">
              <Select
                required
                value={fx.remove_item_id}
                onChange={(e) => setFx({ ...fx, remove_item_id: e.target.value })}
              >
                <option value="">Select…</option>
                {itemOptions}
              </Select>
            </Field>
            <Field label="Quantity removed (base unit)">
              <Input
                type="number"
                min="0.0001"
                step="any"
                required
                value={fx.remove_qty}
                onChange={(e) => setFx({ ...fx, remove_qty: e.target.value })}
              />
            </Field>
          </div>
        )}
        {(effectKind === "add" || effectKind === "replace") && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Adds item">
              <Select
                required
                value={fx.add_item_id}
                onChange={(e) => setFx({ ...fx, add_item_id: e.target.value })}
              >
                <option value="">Select…</option>
                {itemOptions}
              </Select>
            </Field>
            <Field label="Quantity added (base unit)">
              <Input
                type="number"
                min="0.0001"
                step="any"
                required
                value={fx.add_qty}
                onChange={(e) => setFx({ ...fx, add_qty: e.target.value })}
              />
            </Field>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {option ? "Save" : "Create option"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
