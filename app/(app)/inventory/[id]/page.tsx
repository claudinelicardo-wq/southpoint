import { Badge } from "@/components/ui/badge";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type {
  InventoryBatch,
  InventoryItem,
  InventoryMovement,
} from "@/lib/catalog-types";
import { INVENTORY_TYPE_LABELS } from "@/lib/catalog-types";
import { formatDate, formatDateTime, formatPeso, formatQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export const metadata = { title: "Inventory" };

type MovementRow = InventoryMovement & {
  profiles: { full_name: string } | null;
};

const EXPIRING_SOON_DAYS = 7;

function expiryState(expiresAt: string | null): "none" | "ok" | "soon" | "expired" {
  if (!expiresAt) return "none";
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const expiry = new Date(`${expiresAt}T00:00:00`);
  if (expiry < todayStart) return "expired";
  const days = (expiry.getTime() - todayStart.getTime()) / 86_400_000;
  return days <= EXPIRING_SOON_DAYS ? "soon" : "ok";
}

export default async function InventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "inventory.view")) {
    redirect("/dashboard");
  }
  // No data exists in preview mode, so any item id is unknown.
  if (session.preview) notFound();

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("id", id)
    .maybeSingle<InventoryItem>();
  if (!item) notFound();

  const [b, m] = await Promise.all([
    supabase
      .from("inventory_batches")
      .select("*")
      .eq("item_id", id)
      .order("expires_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("inventory_movements")
      .select("*, profiles(full_name)")
      .eq("item_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const batches = (b.data as InventoryBatch[] | null) ?? [];
  const movements = (m.data as MovementRow[] | null) ?? [];

  const summaries = [
    {
      label: "Current stock",
      value: `${formatQty(item.current_stock)} ${item.base_unit}`,
    },
    {
      label: "Avg cost",
      value: `${formatPeso(item.avg_cost)} / ${item.base_unit}`,
    },
    {
      label: "Latest cost",
      value: `${formatPeso(item.latest_cost)} / ${item.base_unit}`,
    },
    {
      label: "Reorder level",
      value: `${formatQty(item.reorder_level)} ${item.base_unit}`,
    },
  ];

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/inventory"
          className="text-sm text-latte underline-offset-2 hover:text-roast hover:underline"
        >
          &larr; Back to inventory
        </Link>
      </div>
      <PageHeader
        title={item.name}
        description={[item.sku && `SKU ${item.sku}`, item.storage_location]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <Badge tone="neutral">{INVENTORY_TYPE_LABELS[item.inventory_type]}</Badge>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaries.map((s) => (
          <Card key={s.label}>
            <CardBody>
              <p className="text-sm text-latte">{s.label}</p>
              <p className="mt-1 text-lg font-semibold text-espresso">{s.value}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="space-y-6">
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-espresso">
            Batches
          </h2>
          {batches.length === 0 ? (
            <EmptyState
              title="No batches"
              description="Batches are created when stock is received through purchases or positive adjustments."
            />
          ) : (
            <Table>
              <THead>
                <TH>Received</TH>
                <TH>Expiry</TH>
                <TH>Qty remaining / received</TH>
                <TH>Unit cost</TH>
              </THead>
              <TBody>
                {batches.map((batch) => {
                  const state = expiryState(batch.expires_at);
                  return (
                    <TR key={batch.id}>
                      <TD className="text-latte">{formatDate(batch.received_at)}</TD>
                      <TD>
                        {batch.expires_at === null ? (
                          <span className="text-latte">—</span>
                        ) : state === "expired" ? (
                          <span className="font-medium text-danger">
                            {formatDate(batch.expires_at)} · Expired
                          </span>
                        ) : state === "soon" ? (
                          <span className="font-medium text-amber">
                            {formatDate(batch.expires_at)} · Expiring soon
                          </span>
                        ) : (
                          <span className="text-espresso">
                            {formatDate(batch.expires_at)}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <span className="font-medium text-espresso">
                          {formatQty(batch.qty_remaining)}
                        </span>{" "}
                        <span className="text-latte">
                          / {formatQty(batch.qty_received)} {item.base_unit}
                        </span>
                      </TD>
                      <TD className="text-latte">
                        {formatPeso(batch.unit_cost)} / {item.base_unit}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-espresso">
            Movement ledger
          </h2>
          {movements.length === 0 ? (
            <EmptyState
              title="No movements yet"
              description="Every stock change (receipts, sales, waste, and adjustments) is recorded here."
            />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Type</TH>
                <TH>Qty</TH>
                <TH>Unit cost</TH>
                <TH>Ref</TH>
                <TH>Reason</TH>
                <TH>Who</TH>
              </THead>
              <TBody>
                {movements.map((mv) => {
                  const qty = Number(mv.qty);
                  return (
                    <TR key={mv.id}>
                      <TD className="whitespace-nowrap text-latte">
                        {formatDateTime(mv.created_at)}
                      </TD>
                      <TD>
                        <Badge tone="neutral">
                          {mv.movement_type.replace(/_/g, " ")}
                        </Badge>
                      </TD>
                      <TD
                        className={
                          qty >= 0
                            ? "font-medium text-court-deep"
                            : "font-medium text-danger"
                        }
                      >
                        {qty >= 0 ? "+" : "-"}
                        {formatQty(Math.abs(qty))} {item.base_unit}
                      </TD>
                      <TD className="text-latte">{formatPeso(mv.unit_cost)}</TD>
                      <TD className="text-latte">
                        {mv.ref_type && mv.ref_id
                          ? `${mv.ref_type}:${mv.ref_id}`
                          : mv.ref_type ?? "—"}
                      </TD>
                      <TD className="text-latte">{mv.reason ?? "—"}</TD>
                      <TD className="text-latte">
                        {mv.profiles?.full_name ?? "—"}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </section>
      </div>
    </div>
  );
}
