import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatPeso, formatQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { DIMENSIONS, type RangeKey, resolveRange } from "@/lib/reports";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ReportsControls } from "./reports-controls";

export const metadata = { title: "Reports" };

interface SalesSummary {
  gross_sales: number;
  discounts: number;
  refunds: number;
  net_sales: number;
  tax: number;
  service_charge: number;
  total_collected: number;
  cogs: number;
  gross_profit: number;
  order_count: number;
  avg_order_value: number;
}

interface BreakdownRow {
  label: string;
  qty: number;
  amount: number;
  cogs: number;
}

const VALID_DIMS = new Set(DIMENSIONS.map((d) => d.key));

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; dim?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "reports.sales")) {
    redirect("/dashboard");
  }
  const showProfit = can(session.permissions, session.profile.role, "reports.profit");

  const sp = await searchParams;
  const rangeKey = (sp.range as RangeKey) || "today";
  const range = resolveRange(rangeKey, sp.from, sp.to);
  const dim = sp.dim && VALID_DIMS.has(sp.dim) ? sp.dim : "product";
  const dimLabel = DIMENSIONS.find((d) => d.key === dim)?.label ?? "By product";

  let summary: SalesSummary | null = null;
  let rows: BreakdownRow[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const [s, b] = await Promise.all([
      supabase.rpc("report_sales_summary", { p_from: range.from, p_to: range.to }),
      supabase.rpc("report_sales_breakdown", {
        p_dim: dim,
        p_from: range.from,
        p_to: range.to,
      }),
    ]);
    summary = (s.data as SalesSummary | null) ?? null;
    rows = ((b.data as BreakdownRow[] | null) ?? []).map((r) => ({
      label: r.label,
      qty: Number(r.qty),
      amount: Number(r.amount),
      cogs: Number(r.cogs),
    }));
  }

  // Dimensions where quantity / COGS are meaningful.
  const showQty = dim !== "payment_method" && dim !== "order_type";
  const showRowCogs = showProfit && dim !== "payment_method";

  const csvHeaders = [dimLabel.replace(/^By /, ""), "Qty", "Amount"];
  if (showRowCogs) csvHeaders.push("COGS", "Gross profit");
  const csvRows: (string | number)[][] = rows.map((r) => {
    const base: (string | number)[] = [r.label, r.qty, r.amount.toFixed(2)];
    if (showRowCogs) base.push(r.cogs.toFixed(2), (r.amount - r.cogs).toFixed(2));
    return base;
  });

  const totalAmount = rows.reduce((acc, r) => acc + r.amount, 0);
  const totalCogs = rows.reduce((acc, r) => acc + r.cogs, 0);

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`Posted sales for ${range.label}. Figures come straight from completed transactions.`}
      />

      <ReportsControls
        rangeKey={rangeKey}
        fromDate={range.fromDate}
        toDate={range.toDate}
        dim={dim}
        csv={{
          filename: `southpoint-sales-${dim}-${range.fromDate}_${range.toDate}.csv`,
          headers: csvHeaders,
          rows: csvRows,
        }}
      />

      {session.preview ? (
        <EmptyState
          title="Connect a database"
          description="Reports read from posted sales — connect Supabase to see live figures."
        />
      ) : (
        <div className="space-y-5">
          {summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Gross sales" value={formatPeso(summary.gross_sales)} />
              <Stat label="Discounts" value={formatPeso(summary.discounts)} />
              <Stat label="Refunds" value={formatPeso(summary.refunds)} />
              <Stat label="Net sales" value={formatPeso(summary.net_sales)} emphasize />
              <Stat label="Tax" value={formatPeso(summary.tax)} />
              <Stat label="Service charge" value={formatPeso(summary.service_charge)} />
              <Stat label="Orders" value={String(summary.order_count)} />
              <Stat label="Avg order value" value={formatPeso(summary.avg_order_value)} />
              {showProfit && (
                <>
                  <Stat label="COGS" value={formatPeso(summary.cogs)} />
                  <Stat
                    label="Gross profit"
                    value={formatPeso(summary.gross_profit)}
                    emphasize
                    hint={
                      summary.net_sales > 0
                        ? `${((summary.gross_profit / summary.net_sales) * 100).toFixed(1)}% margin`
                        : undefined
                    }
                  />
                </>
              )}
            </div>
          )}

          <Card>
            <CardHeader title={`Sales ${dimLabel.toLowerCase()}`} />
            <CardBody>
              {rows.length === 0 ? (
                <EmptyState
                  title="No sales in this range"
                  description="Try a different date range — only completed sales appear here."
                />
              ) : (
                <Table>
                  <THead>
                    <TH>{dimLabel.replace(/^By /, "")}</TH>
                    {showQty && <TH className="text-right">Qty</TH>}
                    <TH className="text-right">Amount</TH>
                    {showRowCogs && <TH className="text-right">COGS</TH>}
                    {showRowCogs && <TH className="text-right">Gross profit</TH>}
                  </THead>
                  <TBody>
                    {rows.map((r) => (
                      <TR key={r.label}>
                        <TD className="text-espresso">{r.label}</TD>
                        {showQty && (
                          <TD className="text-right text-latte">{formatQty(r.qty)}</TD>
                        )}
                        <TD className="text-right font-medium text-espresso">
                          {formatPeso(r.amount)}
                        </TD>
                        {showRowCogs && (
                          <TD className="text-right text-latte">{formatPeso(r.cogs)}</TD>
                        )}
                        {showRowCogs && (
                          <TD className="text-right text-espresso">
                            {formatPeso(r.amount - r.cogs)}
                          </TD>
                        )}
                      </TR>
                    ))}
                    <TR className="border-t-2 border-line font-semibold">
                      <TD className="text-espresso">Total</TD>
                      {showQty && <TD />}
                      <TD className="text-right text-espresso">{formatPeso(totalAmount)}</TD>
                      {showRowCogs && (
                        <TD className="text-right text-latte">{formatPeso(totalCogs)}</TD>
                      )}
                      {showRowCogs && (
                        <TD className="text-right text-espresso">
                          {formatPeso(totalAmount - totalCogs)}
                        </TD>
                      )}
                    </TR>
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-(--radius-card) border border-line bg-paper px-4 py-3 shadow-(--shadow-card)">
      <p className="text-xs text-latte">{label}</p>
      <p
        className={
          emphasize
            ? "mt-0.5 text-xl font-semibold text-court-deep"
            : "mt-0.5 text-xl font-semibold text-espresso"
        }
      >
        {value}
      </p>
      {hint && <p className="text-xs text-latte">{hint}</p>}
    </div>
  );
}
