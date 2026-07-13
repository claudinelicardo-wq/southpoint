import { PageHeader } from "@/components/ui/card";
import type { InventoryItem } from "@/lib/catalog-types";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InventoryTabs } from "../inventory-links";
import { CountsManager, type StockCountRow } from "./counts-manager";

export const metadata = { title: "Stock Counts" };

const headerLink =
  "text-sm text-latte underline-offset-2 hover:text-roast hover:underline";

export default async function CountsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canCount = can(session.permissions, session.profile.role, "inventory.count");
  const canView = can(session.permissions, session.profile.role, "inventory.view");
  if (!canCount && !canView) redirect("/dashboard");

  let counts: StockCountRow[] = [];
  let profileNames: Record<string, string> = {};
  let items: Pick<InventoryItem, "id" | "name" | "base_unit">[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const [c, p, inv] = await Promise.all([
      supabase
        .from("stock_counts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("profiles").select("id, full_name"),
      supabase
        .from("inventory_items")
        .select("id, name, base_unit")
        .is("archived_at", null)
        .order("name"),
    ]);
    counts = (c.data as StockCountRow[] | null) ?? [];
    profileNames = Object.fromEntries(
      ((p.data as { id: string; full_name: string }[] | null) ?? []).map((row) => [
        row.id,
        row.full_name,
      ]),
    );
    items = inv.data ?? [];
  }

  return (
    <div>
      <InventoryTabs active="counts" />
      <PageHeader
        title="Stock counts"
        description="Physical counts against expected stock. Approved variances post to the movement ledger."
        actions={
          <>
            <Link href="/inventory" className={headerLink}>
              Inventory items
            </Link>
            <Link href="/inventory/waste" className={headerLink}>
              Waste
            </Link>
          </>
        }
      />
      <CountsManager
        counts={counts}
        profileNames={profileNames}
        items={items}
        canCount={canCount}
        preview={session.preview}
      />
    </div>
  );
}
