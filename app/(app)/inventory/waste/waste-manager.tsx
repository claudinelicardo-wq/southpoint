"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { InventoryItem, PrepStation, Product, ProductVariant } from "@/lib/catalog-types";
import { STATION_LABELS } from "@/lib/catalog-types";
import { formatDateTime, formatPeso, formatQty } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Row shapes (mirrors supabase/migrations/0007_operations.sql)
// ---------------------------------------------------------------------------

export type WasteReasonCode =
  | "expired"
  | "spoiled"
  | "spilled"
  | "burnt"
  | "wrong_preparation"
  | "damaged"
  | "staff_meal"
  | "complimentary"
  | "sampling"
  | "missing"
  | "other";

export interface WasteRecordRow {
  id: string;
  waste_number: string;
  item_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  qty: number;
  reason_code: WasteReasonCode;
  notes: string | null;
  station: PrepStation | null;
  photo_url: string | null;
  status: "pending" | "approved" | "rejected";
  cost: number | null;
  reported_by: string;
  approved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

const REASON_LABELS: Record<WasteReasonCode, string> = {
  expired: "Expired",
  spoiled: "Spoiled",
  spilled: "Spilled",
  burnt: "Burnt",
  wrong_preparation: "Wrong preparation",
  damaged: "Damaged",
  staff_meal: "Staff meal",
  complimentary: "Complimentary",
  sampling: "Sampling",
  missing: "Missing",
  other: "Other",
};
const REASON_CODES = Object.keys(REASON_LABELS) as WasteReasonCode[];

const STATUS_BADGES = {
  pending: { tone: "warning", label: "Pending" },
  approved: { tone: "success", label: "Approved" },
  rejected: { tone: "danger", label: "Rejected" },
} as const;

const STATIONS: PrepStation[] = ["bar", "kitchen", "none"];

type ItemLite = Pick<InventoryItem, "id" | "name" | "base_unit">;
type ProductLite = Pick<Product, "id" | "name">;
type VariantLite = Pick<ProductVariant, "id" | "product_id" | "name">;

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export function WasteManager({
  records,
  profileNames,
  items,
  products,
  variants,
  canReport,
  canApprove,
  preview,
}: {
  records: WasteRecordRow[];
  profileNames: Record<string, string>;
  items: ItemLite[];
  products: ProductLite[];
  variants: VariantLite[];
  canReport: boolean;
  canApprove: boolean;
  preview: boolean;
}) {
  const router = useRouter();
  const [reportOpen, setReportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const variantsById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);

  const pendingCount = records.filter((r) => r.status === "pending").length;

  async function resolve(record: WasteRecordRow, approve: boolean) {
    setResolvingId(record.id);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("waste_resolve", {
      p_waste: record.id,
      p_approve: approve,
      p_notes: null,
    });
    setResolvingId(null);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  function describe(r: WasteRecordRow): string {
    if (r.item_id) {
      const item = itemsById.get(r.item_id);
      return item?.name ?? "Stock item";
    }
    const product = productsById.get(r.product_id ?? "");
    const variant = r.variant_id ? variantsById.get(r.variant_id) : null;
    const name = product?.name ?? "Prepared item";
    return variant ? `${name} · ${variant.name}` : name;
  }

  function unitOf(r: WasteRecordRow): string {
    if (r.item_id) return itemsById.get(r.item_id)?.base_unit ?? "";
    return "×";
  }

  return (
    <div className="space-y-4">
      {preview && (
        <Alert tone="warning">Waste tracking needs a connected Supabase project.</Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {pendingCount > 0 && (
        <Alert tone="warning">
          {pendingCount} waste {pendingCount === 1 ? "record" : "records"} pending approval
          {canApprove ? " — review below." : "."}
        </Alert>
      )}

      {canReport && (
        <div className="flex justify-end">
          <Button onClick={() => setReportOpen(true)} disabled={preview}>
            Report waste
          </Button>
        </div>
      )}

      {records.length === 0 ? (
        <EmptyState
          title="No waste recorded"
          description="Report expired, spoiled, or comped items to keep stock and costs honest."
          action={
            canReport ? (
              <Button onClick={() => setReportOpen(true)} disabled={preview}>
                Report waste
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TH>Number</TH>
            <TH>Date</TH>
            <TH>What</TH>
            <TH>Qty</TH>
            <TH>Reason</TH>
            <TH>Cost</TH>
            <TH>Status</TH>
            <TH>Reported by</TH>
            {canApprove && <TH className="text-right">Actions</TH>}
          </THead>
          <TBody>
            {records.map((r) => {
              const badge = STATUS_BADGES[r.status];
              return (
                <TR key={r.id}>
                  <TD className="font-medium whitespace-nowrap">{r.waste_number}</TD>
                  <TD className="whitespace-nowrap text-latte">
                    {formatDateTime(r.created_at)}
                  </TD>
                  <TD>
                    <span className="text-espresso">{describe(r)}</span>
                    {r.notes && (
                      <span className="block text-xs text-latte">{r.notes}</span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-espresso">
                    {formatQty(r.qty)} {unitOf(r)}
                  </TD>
                  <TD>
                    <Badge tone="neutral">{REASON_LABELS[r.reason_code]}</Badge>
                  </TD>
                  <TD className="text-latte">
                    {r.cost !== null ? formatPeso(r.cost) : "—"}
                  </TD>
                  <TD>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </TD>
                  <TD className="text-latte">
                    {profileNames[r.reported_by] ?? "—"}
                  </TD>
                  {canApprove && (
                    <TD className="text-right">
                      {r.status === "pending" && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={resolvingId === r.id}
                            onClick={() => resolve(r, true)}
                            disabled={preview}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger"
                            loading={resolvingId === r.id}
                            onClick={() => resolve(r, false)}
                            disabled={preview}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {reportOpen && (
        <ReportWasteDialog
          items={items}
          products={products}
          variants={variants}
          onClose={() => setReportOpen(false)}
          onReported={() => {
            setReportOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report dialog
// ---------------------------------------------------------------------------

function ReportWasteDialog({
  items,
  products,
  variants,
  onClose,
  onReported,
}: {
  items: ItemLite[];
  products: ProductLite[];
  variants: VariantLite[];
  onClose: () => void;
  onReported: () => void;
}) {
  const [mode, setMode] = useState<"item" | "product">("item");
  const [itemId, setItemId] = useState("");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<WasteReasonCode>("expired");
  const [notes, setNotes] = useState("");
  const [station, setStation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedItem = items.find((i) => i.id === itemId);
  const productVariants = useMemo(
    () => variants.filter((v) => v.product_id === productId),
    [variants, productId],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "product" && productVariants.length > 0 && !variantId) {
      setError("Select a variant for this product.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("waste_report", {
      p_item: mode === "item" ? itemId : null,
      p_product: mode === "product" ? productId : null,
      p_variant: mode === "product" && variantId ? variantId : null,
      p_qty: Number(qty),
      p_reason_code: reason,
      p_notes: notes.trim() || null,
      p_station: station || null,
      p_photo_url: null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onReported();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Report waste"
      description="Approved waste deducts inventory at cost — prepared items deduct their recipe."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-sand p-1">
          {(
            [
              { key: "item", label: "Stock item" },
              { key: "product", label: "Prepared item" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setMode(t.key);
                setError(null);
              }}
              className={
                mode === t.key
                  ? "rounded-lg bg-paper px-3 py-1.5 text-sm font-semibold text-espresso shadow-sm"
                  : "rounded-lg px-3 py-1.5 text-sm font-medium text-roast hover:bg-line"
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === "item" ? (
          <Field label="Stock item">
            <Select
              required
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            >
              <option value="" disabled>
                Select an item…
              </option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Product">
              <Select
                required
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setVariantId("");
                }}
              >
                <option value="" disabled>
                  Select a product…
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {productVariants.length > 0 && (
              <Field label="Variant">
                <Select
                  required
                  value={variantId}
                  onChange={(e) => setVariantId(e.target.value)}
                >
                  <option value="" disabled>
                    Select a variant…
                  </option>
                  {productVariants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}

        <Field
          label="Quantity"
          hint={
            mode === "item"
              ? selectedItem
                ? `In base units (${selectedItem.base_unit}).`
                : "In the item's base unit."
              : "Number of servings / units wasted."
          }
        >
          <Input
            type="number"
            min="0.0001"
            step="any"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reason">
            <Select
              value={reason}
              onChange={(e) => setReason(e.target.value as WasteReasonCode)}
            >
              {REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {REASON_LABELS[code]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Station (optional)">
            <Select value={station} onChange={(e) => setStation(e.target.value)}>
              <option value="">—</option>
              {STATIONS.map((s) => (
                <option key={s} value={s}>
                  {STATION_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. found expired in the chiller during opening checks"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Report waste
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
