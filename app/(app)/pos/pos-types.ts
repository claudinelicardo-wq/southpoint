export interface CartItem {
  key: string;
  product_id: string;
  name: string;
  kind: "prepared" | "retail";
  variant_id: string | null;
  variant_name: string | null;
  qty: number;
  unit_price: number; // product + variant delta
  mod_price: number; // Σ modifier deltas
  modifier_option_ids: string[];
  modifier_names: string[];
  notes: string;
}

export interface CartDiscount {
  type: "percent" | "fixed" | "senior" | "pwd" | "manual" | "comp";
  value: number; // 0-1 for percent/manual, pesos for fixed
  reason: string;
  id_reference: string;
}

export type OrderType = "dine_in" | "takeaway" | "courtside" | "tab";

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  courtside: "Courtside",
  tab: "Open Tab",
};

export interface CartState {
  items: CartItem[];
  discounts: CartDiscount[];
  orderType: OrderType;
  tabId: string;
  tabName: string;
  courtsideLabel: string;
  customerId: string;
  notes: string;
}

export const EMPTY_CART: CartState = {
  items: [],
  discounts: [],
  orderType: "dine_in",
  tabId: "",
  tabName: "",
  courtsideLabel: "",
  customerId: "",
  notes: "",
};

/**
 * Client-side preview of the server total computation in pos_checkout.
 * The server is authoritative — this only drives the on-screen running total.
 */
export function estimateTotals(
  items: CartItem[],
  discounts: CartDiscount[],
  tax: Record<string, unknown>,
) {
  const subtotal = round2(
    items.reduce((s, i) => s + i.qty * (i.unit_price + i.mod_price), 0),
  );
  let discountTotal = 0;
  let scPwd = false;
  for (const d of discounts) {
    const base = subtotal - discountTotal;
    if (d.type === "percent" || d.type === "manual") {
      discountTotal += round2(base * d.value);
    } else if (d.type === "fixed") {
      discountTotal += Math.min(d.value, base);
    } else if (d.type === "senior" || d.type === "pwd") {
      const rate = Number(tax.sc_pwd_discount_rate ?? 0.2);
      discountTotal += round2(base * rate);
      scPwd = true;
    } else if (d.type === "comp") {
      discountTotal += base;
    }
  }
  discountTotal = round2(discountTotal);
  const taxable = subtotal - discountTotal;
  let taxTotal = 0;
  let total = taxable;
  const vatRegistered = Boolean(tax.vat_registered ?? false);
  const vatExemptScPwd = scPwd && Boolean(tax.sc_pwd_vat_exempt ?? true);
  if (vatRegistered && !vatExemptScPwd) {
    const rate = Number(tax.vat_rate ?? 0.12);
    if ((tax.pricing_mode ?? "tax_inclusive") === "tax_inclusive") {
      taxTotal = round2((taxable * rate) / (1 + rate));
    } else {
      taxTotal = round2(taxable * rate);
      total = taxable + taxTotal;
    }
  }
  const service = round2(taxable * Number(tax.service_charge_rate ?? 0));
  total = round2(total + service);
  return { subtotal, discountTotal, taxTotal, service, total };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
