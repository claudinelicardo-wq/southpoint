export type PrepStation = "bar" | "kitchen" | "none";
export type ProductKind = "prepared" | "retail";
export type InventoryType = "ingredient" | "packaging" | "retail" | "prepared" | "supply";

export const STATION_LABELS: Record<PrepStation, string> = {
  bar: "Bar",
  kitchen: "Kitchen",
  none: "No preparation",
};

export const INVENTORY_TYPE_LABELS: Record<InventoryType, string> = {
  ingredient: "Raw ingredient",
  packaging: "Packaging",
  retail: "Retail product",
  prepared: "Prepared batch",
  supply: "Operating supply",
};

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  default_station: PrepStation;
  archived_at: string | null;
}

export interface Product {
  id: string;
  kind: ProductKind;
  name: string;
  category_id: string;
  price: number;
  image_url: string | null;
  station: PrepStation;
  prep_minutes: number;
  is_available: boolean;
  tax_exempt: boolean;
  inventory_item_id: string | null;
  archived_at: string | null;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  price_delta: number;
  is_default: boolean;
  is_available: boolean;
  sort_order: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  inventory_type: InventoryType;
  category: string;
  base_unit: string;
  purchase_unit_label: string;
  purchase_to_base_factor: number;
  current_stock: number;
  reorder_level: number;
  target_level: number;
  latest_cost: number;
  avg_cost: number;
  storage_location: string;
  track_expiry: boolean;
  archived_at: string | null;
}

export interface RecipeIngredient {
  id: string;
  product_id: string;
  variant_id: string | null;
  item_id: string;
  qty: number;
  waste_pct: number;
  is_optional: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  selection: "single" | "multi";
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  archived_at: string | null;
}

export interface ModifierOption {
  id: string;
  group_id: string;
  name: string;
  price_delta: number;
  is_available: boolean;
  station_override: PrepStation | null;
  sort_order: number;
}

export interface ModifierOptionEffect {
  id: string;
  option_id: string;
  add_item_id: string | null;
  add_qty: number | null;
  remove_item_id: string | null;
  remove_qty: number | null;
}

export interface InventoryMovement {
  id: number;
  item_id: string;
  batch_id: string | null;
  movement_type: string;
  qty: number;
  unit_cost: number;
  ref_type: string | null;
  ref_id: string | null;
  reason: string | null;
  notes: string | null;
  user_id: string | null;
  created_at: string;
}

export interface InventoryBatch {
  id: string;
  item_id: string;
  qty_received: number;
  qty_remaining: number;
  unit_cost: number;
  received_at: string;
  expires_at: string | null;
}

export function stockStatus(item: Pick<InventoryItem, "current_stock" | "reorder_level">):
  | "out"
  | "low"
  | "ok" {
  if (item.current_stock <= 0) return "out";
  if (item.reorder_level > 0 && item.current_stock <= item.reorder_level) return "low";
  return "ok";
}
