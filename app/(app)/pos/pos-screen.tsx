"use client";

import { BarcodeScanner } from "@/components/barcode-scanner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type {
  Category,
  InventoryItem,
  ModifierGroup,
  ModifierOption,
  Product,
  ProductVariant,
} from "@/lib/catalog-types";
import { formatDateTime, formatPeso, manilaDateKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ItemDialog } from "./item-dialog";
import { PaymentDialog } from "./payment-dialog";
import {
  EMPTY_CART,
  ORDER_TYPE_LABELS,
  estimateTotals,
  type CartDiscount,
  type CartItem,
  type CartState,
  type OrderType,
} from "./pos-types";

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  kind: string;
  requires_reference: boolean;
}

export interface OpenTab {
  id: string;
  name: string;
}

export interface CustomerLite {
  id: string;
  full_name: string;
  mobile: string | null;
}

const CART_KEY = "southpoint.pos.cart.v1";

export function POSScreen({
  categories,
  products,
  variants,
  groups,
  options,
  productGroups,
  retailStock,
  paymentMethods,
  openTabs,
  customers,
  shiftId,
  shiftOpenedAt,
  taxConfig,
  gcashQrImage,
  canManualDiscount,
  preview,
}: {
  categories: Category[];
  products: Product[];
  variants: ProductVariant[];
  groups: ModifierGroup[];
  options: ModifierOption[];
  productGroups: { product_id: string; group_id: string }[];
  retailStock: Pick<InventoryItem, "id" | "current_stock" | "barcode">[];
  paymentMethods: PaymentMethod[];
  openTabs: OpenTab[];
  customers: CustomerLite[];
  shiftId: string | null;
  shiftOpenedAt: string | null;
  taxConfig: Record<string, unknown>;
  gcashQrImage: string | null;
  canManualDiscount: boolean;
  preview: boolean;
}) {
  const router = useRouter();
  const orderPanelRef = useRef<HTMLDivElement>(null);
  const [cart, setCart] = useState<CartState>(EMPTY_CART);
  const [hydrated, setHydrated] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [itemDialog, setItemDialog] = useState<Product | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [shiftOpenDialog, setShiftOpenDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ orderNumber: string; orderId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Restore the unsent cart after refresh/crash. This runs once on mount:
  // localStorage is unavailable during SSR, so a lazy useState initializer
  // can't be used here — hydrating from an effect is the SSR-safe pattern.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage hydration; safe and intentional
      if (raw) setCart({ ...EMPTY_CART, ...(JSON.parse(raw) as CartState) });
    } catch {
      // corrupted cart — start fresh
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart, hydrated]);

  const stockByItem = useMemo(
    () => new Map(retailStock.map((r) => [r.id, Number(r.current_stock)])),
    [retailStock],
  );

  // barcode -> inventory_item_id, then inventory_item_id -> product, so a
  // scan resolves straight to the sellable product regardless of which
  // table actually stores the barcode.
  const productByBarcode = useMemo(() => {
    const itemIdByBarcode = new Map(
      retailStock.filter((r) => r.barcode).map((r) => [r.barcode as string, r.id]),
    );
    const productByItemId = new Map(
      products.filter((p) => p.inventory_item_id).map((p) => [p.inventory_item_id as string, p]),
    );
    const map = new Map<string, Product>();
    for (const [barcode, itemId] of itemIdByBarcode) {
      const product = productByItemId.get(itemId);
      if (product) map.set(barcode, product);
    }
    return map;
  }, [retailStock, products]);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanAutoAdd, setScanAutoAdd] = useState(true);
  const [scanResult, setScanResult] = useState<{ product: Product; addedAt: number } | null>(null);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  function handleScan(code: string) {
    // The camera decoder fires continuously while a code sits in frame, and
    // a hardware scanner can double-fire — ignore the same code for 2s.
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < 2000) return;
    lastScanRef.current = { code, at: now };

    const product = productByBarcode.get(code);
    if (!product) {
      setScanMiss(code);
      setScanResult(null);
      return;
    }
    setScanMiss(null);
    setScanResult({ product, addedAt: now });
    if (scanAutoAdd) addProduct(product);
  }

  // Hardware "keyboard wedge" scanners type the code fast (well under human
  // typing speed) then send Enter. Ignored while any text field has focus so
  // normal typing never gets mistaken for a scan.
  useEffect(() => {
    let buffer = "";
    let lastKeyAt = 0;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const now = Date.now();
      if (now - lastKeyAt > 75) buffer = "";
      lastKeyAt = now;
      if (e.key === "Enter") {
        if (buffer.length >= 3) handleScan(buffer);
        buffer = "";
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleScan closes over state via refs/maps that are stable per render; re-subscribing every render is unnecessary
  }, [productByBarcode, scanAutoAdd]);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCategory !== "all" && p.category_id !== activeCategory) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, activeCategory, search]);

  const totals = useMemo(
    () => estimateTotals(cart.items, cart.discounts, taxConfig),
    [cart.items, cart.discounts, taxConfig],
  );

  function addProduct(p: Product) {
    const pVariants = variants.filter((v) => v.product_id === p.id);
    const pGroupIds = productGroups.filter((pg) => pg.product_id === p.id).map((pg) => pg.group_id);
    if (pVariants.length > 0 || pGroupIds.length > 0) {
      setItemDialog(p);
      return;
    }
    pushItem({
      key: crypto.randomUUID(),
      product_id: p.id,
      name: p.name,
      kind: p.kind,
      variant_id: null,
      variant_name: null,
      qty: 1,
      unit_price: Number(p.price),
      mod_price: 0,
      modifier_option_ids: [],
      modifier_names: [],
      notes: "",
    });
  }

  function pushItem(item: CartItem) {
    setCart((c) => {
      // merge identical lines (same product/variant/modifiers, no notes)
      const match = c.items.find(
        (i) =>
          i.product_id === item.product_id &&
          i.variant_id === item.variant_id &&
          i.notes === "" &&
          item.notes === "" &&
          JSON.stringify([...i.modifier_option_ids].sort()) ===
            JSON.stringify([...item.modifier_option_ids].sort()),
      );
      if (match) {
        return {
          ...c,
          items: c.items.map((i) =>
            i.key === match.key ? { ...i, qty: i.qty + item.qty } : i,
          ),
        };
      }
      return { ...c, items: [...c.items, item] };
    });
  }

  function updateQty(key: string, delta: number) {
    setCart((c) => ({
      ...c,
      items: c.items
        .map((i) => (i.key === key ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0),
    }));
  }

  async function checkout(
    payments: { method: string; amount: number; reference_no?: string; tendered?: number }[],
    hold: boolean,
  ) {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      order_type: cart.orderType,
      tab_id: cart.orderType === "tab" ? cart.tabId || null : null,
      tab_name: cart.orderType === "tab" && !cart.tabId ? cart.tabName : null,
      courtside_label: cart.orderType === "courtside" ? cart.courtsideLabel : null,
      customer_id: cart.customerId || null,
      notes: cart.notes || null,
      hold,
      items: cart.items.map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id,
        qty: i.qty,
        notes: i.notes || null,
        modifier_option_ids: i.modifier_option_ids,
      })),
      discounts: cart.discounts.map((d) => ({
        type: d.type,
        value: d.value,
        reason: d.reason || null,
        id_reference: d.id_reference || null,
      })),
      payments,
    };
    // One idempotency key per attempt-set: stored so a retry after a network
    // failure reuses it and cannot double-post.
    let key = sessionStorage.getItem("southpoint.pos.pending-key");
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem("southpoint.pos.pending-key", key);
    }
    const { data, error } = await supabase.rpc("pos_checkout", {
      p_payload: payload,
      p_idempotency_key: key,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return false;
    }
    sessionStorage.removeItem("southpoint.pos.pending-key");
    const result = data as { order_id: string; order_number: string };
    setSuccess({ orderNumber: result.order_number, orderId: result.order_id });
    setCart(EMPTY_CART);
    setPayOpen(false);
    router.refresh();
    return true;
  }

  const needsShift = !preview && !shiftId;
  // A shift opened on a previous Manila business day silently corrupts cash
  // reconciliation — surface it loudly instead of letting sales pile onto it.
  const staleShift =
    !preview &&
    shiftId !== null &&
    shiftOpenedAt !== null &&
    manilaDateKey(shiftOpenedAt) < manilaDateKey(new Date().toISOString());
  const canCharge =
    cart.items.length > 0 &&
    !needsShift &&
    (cart.orderType !== "tab" || cart.tabId !== "" || cart.tabName.trim() !== "") &&
    (cart.orderType !== "courtside" || cart.courtsideLabel.trim() !== "");

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-8.5rem)] lg:min-h-[480px] lg:flex-row">
      {/* ------------------------------------------------ product browser */}
      <div className="flex min-w-0 flex-1 flex-col">
        {preview && (
          <Alert tone="warning" className="mb-3">
            POS needs a connected Supabase project. Tiles below are empty.
          </Alert>
        )}
        {needsShift && (
          <Alert tone="warning" className="mb-3" title="No open shift">
            <div className="flex items-center justify-between gap-3">
              <span>Open a shift to start selling.</span>
              <Button size="sm" onClick={() => setShiftOpenDialog(true)}>
                Open shift
              </Button>
            </div>
          </Alert>
        )}
        {staleShift && (
          <Alert tone="danger" className="mb-3" title="Shift left open from a previous day">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                This shift was opened {shiftOpenedAt ? formatDateTime(shiftOpenedAt) : ""}. Close
                it with a cash count and open a fresh one before selling, or today&apos;s cash
                won&apos;t reconcile.
              </span>
              <Link href="/shifts">
                <Button size="sm" variant="danger">
                  Go to Shifts
                </Button>
              </Link>
            </div>
          </Alert>
        )}
        {success && (
          <Alert tone="success" className="mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Sale <strong>{success.orderNumber}</strong> completed.
              </span>
              <span className="flex gap-3">
                <Link href={`/receipt/${success.orderId}`} className="font-semibold underline">
                  Print receipt
                </Link>
                <button className="underline" onClick={() => setSuccess(null)}>
                  Dismiss
                </button>
              </span>
            </div>
          </Alert>
        )}
        <div className="mb-3 flex gap-2">
          <Input
            placeholder="Search menu and products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            onClick={() => {
              setScanMiss(null);
              setScanResult(null);
              setScanOpen(true);
            }}
          >
            Scan
          </Button>
        </div>
        {scanMiss && (
          <Alert tone="warning" className="mb-3">
            No product matches barcode &ldquo;{scanMiss}&rdquo;.
          </Alert>
        )}
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          <CategoryPill
            active={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
            label="All"
          />
          {categories.map((c) => (
            <CategoryPill
              key={c.id}
              active={activeCategory === c.id}
              onClick={() => setActiveCategory(c.id)}
              label={c.name}
            />
          ))}
        </div>
        <div className="grid auto-rows-min grid-cols-2 gap-2.5 pb-4 sm:grid-cols-3 lg:flex-1 lg:overflow-y-auto xl:grid-cols-4">
          {visibleProducts.map((p) => {
            const stock = p.inventory_item_id ? stockByItem.get(p.inventory_item_id) : undefined;
            const outOfStock = p.kind === "retail" && stock !== undefined && stock <= 0;
            const disabled = !p.is_available || outOfStock;
            return (
              <button
                key={p.id}
                disabled={disabled}
                onClick={() => addProduct(p)}
                className={cn(
                  "flex min-h-24 flex-col items-start justify-between rounded-2xl border p-3 text-left transition",
                  disabled
                    ? "cursor-not-allowed border-line bg-sand/50 opacity-60"
                    : "border-line bg-paper shadow-(--shadow-card) hover:border-court active:scale-[0.98]",
                )}
              >
                <span className="line-clamp-2 font-medium text-espresso">{p.name}</span>
                <span className="mt-2 flex w-full items-center justify-between">
                  <span className="text-sm font-semibold text-court-deep">
                    {formatPeso(p.price)}
                  </span>
                  {outOfStock ? (
                    <Badge tone="danger">Out</Badge>
                  ) : !p.is_available ? (
                    <Badge tone="warning">86’d</Badge>
                  ) : p.kind === "retail" && stock !== undefined && stock <= 5 ? (
                    <span className="text-xs text-latte">{stock} left</span>
                  ) : null}
                </span>
              </button>
            );
          })}
          {visibleProducts.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-latte">
              No items match.
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ order panel */}
      <div
        ref={orderPanelRef}
        className="flex w-full scroll-mt-4 flex-col rounded-(--radius-card) border border-line bg-paper shadow-(--shadow-card) lg:w-80 lg:shrink-0 xl:w-96"
      >
        <div className="border-b border-line p-3">
          <div className="grid grid-cols-4 gap-1">
            {(Object.keys(ORDER_TYPE_LABELS) as OrderType[]).map((t) => (
              <button
                key={t}
                onClick={() => setCart((c) => ({ ...c, orderType: t }))}
                className={cn(
                  "rounded-lg px-1 py-1.5 text-[11px] font-semibold transition-colors",
                  cart.orderType === t
                    ? "bg-court text-white"
                    : "bg-sand text-roast hover:bg-line",
                )}
              >
                {ORDER_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          {cart.orderType === "courtside" && (
            <Input
              className="mt-2 h-9"
              placeholder="Group / booking label (e.g. 6:00 PM Players)"
              value={cart.courtsideLabel}
              onChange={(e) => setCart((c) => ({ ...c, courtsideLabel: e.target.value }))}
            />
          )}
          {cart.orderType === "tab" && (
            <div className="mt-2 space-y-2">
              <Select
                className="h-9 py-1"
                value={cart.tabId}
                onChange={(e) => setCart((c) => ({ ...c, tabId: e.target.value }))}
              >
                <option value="">New tab…</option>
                {openTabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              {cart.tabId === "" && (
                <Input
                  className="h-9"
                  placeholder="Tab name (e.g. Claudine’s Group)"
                  value={cart.tabName}
                  onChange={(e) => setCart((c) => ({ ...c, tabName: e.target.value }))}
                />
              )}
            </div>
          )}
          <Select
            className="mt-2 h-9 py-1"
            value={cart.customerId}
            onChange={(e) => setCart((c) => ({ ...c, customerId: e.target.value }))}
          >
            <option value="">Walk-in customer</option>
            {customers.map((cu) => (
              <option key={cu.id} value={cu.id}>
                {cu.full_name}
                {cu.mobile ? ` · ${cu.mobile}` : ""}
              </option>
            ))}
          </Select>
        </div>

        <div className="max-h-72 overflow-y-auto p-3 lg:max-h-none lg:flex-1">
          {cart.items.length === 0 ? (
            <p className="py-12 text-center text-sm text-latte">
              Tap items to start an order.
            </p>
          ) : (
            <ul className="space-y-2">
              {cart.items.map((i) => (
                <li key={i.key} className="rounded-xl bg-cream p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-espresso">
                        {i.name}
                        {i.variant_name && (
                          <span className="text-latte"> · {i.variant_name}</span>
                        )}
                      </p>
                      {i.modifier_names.length > 0 && (
                        <p className="text-xs text-latte">{i.modifier_names.join(", ")}</p>
                      )}
                      {i.notes && <p className="text-xs italic text-clay">“{i.notes}”</p>}
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-espresso">
                      {formatPeso(i.qty * (i.unit_price + i.mod_price))}
                    </p>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      onClick={() => updateQty(i.key, -1)}
                      className="grid size-8 place-items-center rounded-lg bg-paper text-lg font-bold text-roast shadow-sm active:scale-95"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{i.qty}</span>
                    <button
                      onClick={() => updateQty(i.key, 1)}
                      className="grid size-8 place-items-center rounded-lg bg-paper text-lg font-bold text-roast shadow-sm active:scale-95"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                    <NoteButton
                      value={i.notes}
                      onChange={(v) =>
                        setCart((c) => ({
                          ...c,
                          items: c.items.map((x) => (x.key === i.key ? { ...x, notes: v } : x)),
                        }))
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-line p-3">
          {error && (
            <Alert tone="danger" className="mb-2">
              {error}
            </Alert>
          )}
          <div className="space-y-1 text-sm">
            <Row label="Subtotal" value={formatPeso(totals.subtotal)} />
            {totals.discountTotal > 0 && (
              <Row label="Discount" value={`−${formatPeso(totals.discountTotal)}`} accent />
            )}
            {totals.taxTotal > 0 && <Row label="VAT" value={formatPeso(totals.taxTotal)} muted />}
            {totals.service > 0 && (
              <Row label="Service charge" value={formatPeso(totals.service)} muted />
            )}
            <div className="flex items-center justify-between pt-1 text-base font-bold text-espresso">
              <span>Total</span>
              <span>{formatPeso(totals.total)}</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={() => setDiscountOpen(true)}
              disabled={cart.items.length === 0}>
              Discount
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={cart.items.length === 0 || busy}
              onClick={() => checkout([], true)}
            >
              Hold
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={cart.items.length === 0}
              onClick={() => setClearOpen(true)}
            >
              Clear
            </Button>
          </div>
          <Button
            size="pos"
            className="mt-2 w-full"
            disabled={!canCharge || busy}
            onClick={() =>
              cart.orderType === "tab"
                ? checkout([], false) // post to tab, pay later
                : setPayOpen(true)
            }
            loading={busy && !payOpen}
          >
            {cart.orderType === "tab" ? "Add to tab" : `Charge ${formatPeso(totals.total)}`}
          </Button>
        </div>
      </div>

      {/* Mobile-only: the order panel is stacked below the product grid,
          so without this a tapped item adds silently off-screen. Tapping
          it scrolls the order panel into view. */}
      {cart.items.length > 0 && (
        <button
          type="button"
          onClick={() => orderPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-between rounded-2xl bg-court px-5 py-3.5 text-white shadow-lg lg:hidden"
        >
          <span className="text-sm font-medium">
            View order · {cart.items.reduce((n, i) => n + i.qty, 0)} item
            {cart.items.reduce((n, i) => n + i.qty, 0) === 1 ? "" : "s"}
          </span>
          <span className="text-sm font-bold">{formatPeso(totals.total)}</span>
        </button>
      )}

      {/* ------------------------------------------------ dialogs */}
      {scanOpen && (
        <Dialog
          open
          onClose={() => setScanOpen(false)}
          title="Scan barcode"
          description="Point the camera at a barcode. A hardware scanner works anywhere on this screen too, dialog or not."
        >
          <div className="space-y-3">
            <BarcodeScanner active={scanOpen} onDetect={handleScan} />
            <label className="flex items-center gap-2 text-sm text-roast">
              <input
                type="checkbox"
                checked={scanAutoAdd}
                onChange={(e) => setScanAutoAdd(e.target.checked)}
              />
              Add to cart automatically (uncheck for a price check only)
            </label>
            {scanMiss && (
              <Alert tone="warning">No product matches barcode &ldquo;{scanMiss}&rdquo;.</Alert>
            )}
            {scanResult && (
              <div className="flex items-center justify-between rounded-xl bg-cream p-3">
                <div>
                  <p className="font-medium text-espresso">{scanResult.product.name}</p>
                  <p className="text-sm text-latte">{formatPeso(scanResult.product.price)}</p>
                </div>
                {!scanAutoAdd && (
                  <Button size="sm" onClick={() => addProduct(scanResult.product)}>
                    Add to cart
                  </Button>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setScanOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {itemDialog && (
        <ItemDialog
          product={itemDialog}
          variants={variants.filter((v) => v.product_id === itemDialog.id)}
          groups={groups.filter((g) =>
            productGroups.some((pg) => pg.product_id === itemDialog.id && pg.group_id === g.id),
          )}
          options={options}
          onAdd={(item) => {
            pushItem(item);
            setItemDialog(null);
          }}
          onClose={() => setItemDialog(null)}
        />
      )}
      {payOpen && (
        <PaymentDialog
          total={totals.total}
          methods={paymentMethods}
          gcashQrImage={gcashQrImage}
          busy={busy}
          onSubmit={(payments) => checkout(payments, false)}
          onClose={() => setPayOpen(false)}
        />
      )}
      {discountOpen && (
        <DiscountDialog
          discounts={cart.discounts}
          canManual={canManualDiscount}
          onChange={(d) => setCart((c) => ({ ...c, discounts: d }))}
          onClose={() => setDiscountOpen(false)}
        />
      )}
      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={() => {
          setCart(EMPTY_CART);
          setClearOpen(false);
        }}
        title="Clear this order?"
        message="All items and discounts in the current order will be removed."
        confirmLabel="Clear order"
      />
      {shiftOpenDialog && (
        <ShiftOpenDialog
          onClose={() => setShiftOpenDialog(false)}
          onOpened={() => {
            setShiftOpenDialog(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        muted && "text-latte",
        accent && "text-clay",
      )}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function CategoryPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-espresso text-cream" : "bg-sand text-roast hover:bg-line",
      )}
    >
      {label}
    </button>
  );
}

function NoteButton({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <>
      <button
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        className={cn(
          "ml-auto rounded-lg px-2 py-1 text-xs font-medium",
          value ? "bg-clay-soft text-clay" : "text-latte hover:bg-sand",
        )}
      >
        {value ? "Edit note" : "Note"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Item note">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. less ice, sauce on the side"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onChange(draft.trim());
              setOpen(false);
            }}
          >
            Save note
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function DiscountDialog({
  discounts,
  canManual,
  onChange,
  onClose,
}: {
  discounts: CartDiscount[];
  canManual: boolean;
  onChange: (d: CartDiscount[]) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<CartDiscount["type"]>("senior");
  // Kept as a string while editing — Number("") coercing to 0 on every
  // keystroke made the field snap back to "0" and block typing.
  const [value, setValue] = useState("10");
  const [reason, setReason] = useState("");
  const [idRef, setIdRef] = useState("");

  function add() {
    const numValue = Number(value) || 0;
    const d: CartDiscount = {
      type,
      value: type === "fixed" ? numValue : numValue / 100,
      reason,
      id_reference: idRef,
    };
    if (type === "senior" || type === "pwd") d.value = 0; // server uses configured rate
    onChange([...discounts, d]);
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title="Add discount">
      <div className="space-y-4">
        {discounts.length > 0 && (
          <div className="space-y-1">
            {discounts.map((d, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-cream px-3 py-1.5 text-sm">
                <span className="capitalize">
                  {d.type}
                  {d.type === "percent" || d.type === "manual"
                    ? ` ${(d.value * 100).toFixed(0)}%`
                    : d.type === "fixed"
                      ? ` ${formatPeso(d.value)}`
                      : ""}
                </span>
                <button
                  className="text-danger underline"
                  onClick={() => onChange(discounts.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <Field label="Discount type">
          <Select value={type} onChange={(e) => setType(e.target.value as CartDiscount["type"])}>
            <option value="senior">Senior Citizen</option>
            <option value="pwd">PWD</option>
            {canManual && <option value="percent">Percent</option>}
            {canManual && <option value="fixed">Fixed amount</option>}
            {canManual && <option value="comp">Complimentary (100%)</option>}
          </Select>
        </Field>
        {(type === "percent" || type === "fixed") && (
          <Field label={type === "percent" ? "Percent (%)" : "Amount (₱)"}>
            <Input
              type="number"
              min="0"
              max={type === "percent" ? 100 : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
        )}
        {(type === "senior" || type === "pwd") && (
          <Field label="SC / PWD ID number" hint="Required and kept on the sale record.">
            <Input value={idRef} onChange={(e) => setIdRef(e.target.value)} required />
          </Field>
        )}
        <Field label="Reason / notes">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} disabled={(type === "senior" || type === "pwd") && !idRef.trim()}>
            Add discount
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ShiftOpenDialog({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: () => void;
}) {
  // Kept as a string while editing — Number("") coercing to 0 on every
  // keystroke made the field snap back to "0" and block typing.
  const [cash, setCash] = useState("0");
  const [terminal, setTerminal] = useState("Main");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("shift_open", {
      p_opening_cash: Number(cash) || 0,
      p_terminal: terminal,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onOpened();
  }

  return (
    <Dialog open onClose={onClose} title="Open shift" description="Count the drawer before starting.">
      <form onSubmit={open} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Opening cash (₱)">
          <Input
            type="number"
            min="0"
            step="0.25"
            required
            value={cash}
            onChange={(e) => setCash(e.target.value)}
          />
        </Field>
        <Field label="Terminal / drawer">
          <Input value={terminal} onChange={(e) => setTerminal(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Open shift
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
