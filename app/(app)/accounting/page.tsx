import { RangeBar } from "@/components/range-bar";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPeso } from "@/lib/format";
import { can } from "@/lib/permissions";
import { type RangeKey, resolveRange } from "@/lib/reports";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Accounting" };

interface Pnl {
  net_sales: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number;
  waste_cost: number;
  operating_expenses: number;
  estimated_net_profit: number;
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "reports.profit")) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const rangeKey = (sp.range as RangeKey) || "month";
  const range = resolveRange(rangeKey, sp.from, sp.to);

  let pnl: Pnl | null = null;
  let inventoryValue = 0;
  let payables = 0;
  let collections: { name: string; amount: number }[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const [p, inv, pay, coll] = await Promise.all([
      supabase.rpc("report_pnl", { p_from: range.from, p_to: range.to }),
      supabase.rpc("report_inventory_valuation"),
      supabase.from("v_po_payables").select("balance"),
      supabase.rpc("report_sales_breakdown", {
        p_dim: "payment_method",
        p_from: range.from,
        p_to: range.to,
      }),
    ]);
    pnl = (p.data as Pnl | null) ?? null;
    inventoryValue = ((inv.data as { value: number }[] | null) ?? []).reduce(
      (acc, r) => acc + Number(r.value ?? 0),
      0,
    );
    payables = ((pay.data as { balance: number }[] | null) ?? []).reduce(
      (acc, r) => acc + Math.max(0, Number(r.balance)),
      0,
    );
    collections = ((coll.data as { label: string; amount: number }[] | null) ?? []).map(
      (r) => ({ name: r.label, amount: Number(r.amount) }),
    );
  }

  return (
    <div>
      <PageHeader
        title="Accounting"
        description="Estimated operating performance from posted records. Not a substitute for certified accounting software."
      />

      <RangeBar rangeKey={rangeKey} fromDate={range.fromDate} toDate={range.toDate} />

      {session.preview ? (
        <EmptyState
          title="Connect a database"
          description="Accounting figures are computed from posted sales, expenses, and inventory."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Estimated operating P&L"
              description={`For ${range.label}`}
            />
            <CardBody>
              {pnl && (
                <dl className="divide-y divide-line">
                  <Line label="Net sales" value={pnl.net_sales} strong />
                  <Line label="Less: Cost of goods sold" value={-pnl.cogs} />
                  <Line
                    label="Gross profit"
                    value={pnl.gross_profit}
                    strong
                    hint={`${pnl.gross_margin_pct}% margin`}
                  />
                  <Line label="Less: Waste & spoilage" value={-pnl.waste_cost} />
                  <Line label="Less: Operating expenses" value={-pnl.operating_expenses} />
                  <Line
                    label="Estimated net operating profit"
                    value={pnl.estimated_net_profit}
                    strong
                    emphasize
                  />
                </dl>
              )}
              <p className="mt-4 rounded-lg bg-sand px-3 py-2 text-xs text-latte">
                Estimated figures. COGS uses the cost snapshot posted with each sale; waste
                and expenses use approved records only.
              </p>
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Collections" description={`For ${range.label}`} />
              <CardBody>
                {collections.length === 0 ? (
                  <p className="text-sm text-latte">No payments in this range.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {collections.map((c) => (
                      <li key={c.name} className="flex items-center justify-between text-sm">
                        <span className="text-roast">{c.name}</span>
                        <span className="font-medium text-espresso">
                          {formatPeso(c.amount)}
                        </span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between border-t border-line pt-1.5 text-sm font-semibold">
                      <span className="text-espresso">Total collected</span>
                      <span className="text-espresso">
                        {formatPeso(collections.reduce((a, c) => a + c.amount, 0))}
                      </span>
                    </li>
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Balance sheet snapshot" />
              <CardBody>
                <dl className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <dt className="text-roast">Inventory value (at cost)</dt>
                    <dd className="font-medium text-espresso">{formatPeso(inventoryValue)}</dd>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <dt className="text-roast">Supplier payables</dt>
                    <dd className="font-medium text-clay">{formatPeso(payables)}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  emphasize,
  hint,
}: {
  label: string;
  value: number;
  strong?: boolean;
  emphasize?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className={strong ? "text-sm font-medium text-espresso" : "text-sm text-roast"}>
        {label}
      </dt>
      <dd className="flex items-baseline gap-2">
        {hint && <span className="text-xs text-latte">{hint}</span>}
        <span className={valueClass(value, strong, emphasize)}>
          {value < 0 ? `(${formatPeso(-value)})` : formatPeso(value)}
        </span>
      </dd>
    </div>
  );
}

function valueClass(value: number, strong?: boolean, emphasize?: boolean): string {
  if (emphasize)
    return value < 0
      ? "text-lg font-bold text-danger"
      : "text-lg font-bold text-court-deep";
  if (strong) return "text-sm font-semibold text-espresso";
  return "text-sm text-roast";
}
