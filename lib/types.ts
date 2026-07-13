export type StaffRole =
  | "owner"
  | "manager"
  | "cashier"
  | "kitchen"
  | "inventory"
  | "accountant";

export const STAFF_ROLES: StaffRole[] = [
  "owner",
  "manager",
  "cashier",
  "kitchen",
  "inventory",
  "accountant",
];

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  kitchen: "Barista / Kitchen",
  inventory: "Inventory Staff",
  accountant: "Accountant",
};

export interface Profile {
  id: string;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SettingRow {
  key: string;
  value: Record<string, unknown>;
  is_sensitive: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}
