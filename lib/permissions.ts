import type { StaffRole } from "./types";

/**
 * Fine-grained permission keys. Defaults per role are seeded in migration 0001
 * (role_permissions) and owner-editable at runtime. The owner role implicitly
 * holds every permission (enforced in public.has_permission).
 */
export const PERMISSIONS = [
  "pos.sell",
  "pos.discount.manual",
  "pos.refund",
  "pos.void",
  "tabs.manage",
  "tabs.reopen",
  "orders.view",
  "kds.view",
  "kds.update",
  "catalog.view",
  "catalog.manage",
  "inventory.view",
  "inventory.adjust",
  "inventory.receive",
  "inventory.count",
  "inventory.waste",
  "inventory.waste.approve",
  "inventory.produce",
  "purchasing.view",
  "purchasing.manage",
  "suppliers.manage",
  "expenses.view",
  "expenses.manage",
  "expenses.approve",
  "customers.view.basic",
  "customers.manage",
  "loyalty.manage",
  "loyalty.adjust",
  "shifts.own",
  "shifts.manage",
  "shifts.view_expected_cash",
  "reports.sales",
  "reports.profit",
  "reports.inventory",
  "reports.shifts",
  "reports.export",
  "staff.manage",
  "audit.view",
  "settings.manage",
  "settings.manage_sensitive",
  "court.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type PermissionSet = ReadonlySet<string>;

export function can(perms: PermissionSet, role: StaffRole, p: Permission): boolean {
  return role === "owner" || perms.has(p);
}

export interface NavItem {
  label: string;
  href: string;
  /** Shown when the user holds ANY of these permissions. */
  anyOf: Permission[];
  section: "operate" | "manage" | "money" | "admin";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", anyOf: [], section: "operate" },
  { label: "POS", href: "/pos", anyOf: ["pos.sell"], section: "operate" },
  { label: "Active Orders", href: "/orders", anyOf: ["orders.view"], section: "operate" },
  { label: "Pre-orders", href: "/preorders", anyOf: ["orders.view"], section: "operate" },
  { label: "Kitchen / Bar", href: "/kds", anyOf: ["kds.view"], section: "operate" },
  { label: "Shifts", href: "/shifts", anyOf: ["shifts.own", "shifts.manage"], section: "operate" },
  { label: "Menu", href: "/menu", anyOf: ["catalog.manage"], section: "manage" },
  { label: "Products", href: "/products", anyOf: ["catalog.manage", "inventory.view"], section: "manage" },
  { label: "Recipes", href: "/recipes", anyOf: ["catalog.manage"], section: "manage" },
  { label: "Inventory", href: "/inventory", anyOf: ["inventory.view"], section: "manage" },
  { label: "Purchasing", href: "/purchasing", anyOf: ["purchasing.view"], section: "manage" },
  { label: "Suppliers", href: "/suppliers", anyOf: ["suppliers.manage"], section: "manage" },
  { label: "Customers", href: "/customers", anyOf: ["customers.view.basic"], section: "manage" },
  { label: "Loyalty", href: "/loyalty", anyOf: ["loyalty.manage"], section: "manage" },
  { label: "Expenses", href: "/expenses", anyOf: ["expenses.view"], section: "money" },
  { label: "Accounting", href: "/accounting", anyOf: ["reports.profit"], section: "money" },
  { label: "Reports", href: "/reports", anyOf: ["reports.sales"], section: "money" },
  { label: "Staff", href: "/staff", anyOf: ["staff.manage"], section: "admin" },
  { label: "Audit Logs", href: "/audit-logs", anyOf: ["audit.view"], section: "admin" },
  { label: "Settings", href: "/settings", anyOf: ["settings.manage"], section: "admin" },
];

export function visibleNav(role: StaffRole, perms: PermissionSet): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.anyOf.length === 0 || item.anyOf.some((p) => can(perms, role, p)),
  );
}
