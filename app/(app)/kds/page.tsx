import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { KDSBoard, type KDSOrder } from "./kds-board";

export const metadata = { title: "Kitchen / Bar" };

export default async function KDSPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "kds.view")) {
    redirect("/dashboard");
  }

  let orders: KDSOrder[] = [];
  if (!session.preview) {
    const supabase = await createClient();
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_number, order_type, courtside_label, notes, completed_at, tabs(name), customers(full_name), order_items(id, product_name, variant_name, qty, station, prep_status, prep_status_at, notes, order_item_modifiers(option_name, group_name))",
      )
      .eq("status", "completed")
      .gte("completed_at", since)
      .order("completed_at", { ascending: true });
    orders = (data ?? []) as unknown as KDSOrder[];
  }

  return (
    <KDSBoard
      initialOrders={orders}
      canUpdate={can(session.permissions, session.profile.role, "kds.update")}
      preview={session.preview}
    />
  );
}
