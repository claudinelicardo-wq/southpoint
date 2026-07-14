import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime, formatPeso, formatQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata = { title: "Loyalty" };

interface LoyaltyConfig {
  enabled?: boolean;
  points_per_peso?: number;
  min_purchase?: number;
  redemption_value_per_point?: number;
  max_redemption_pct?: number;
  points_expiry_days?: number;
  birthday_bonus_points?: number;
}

type TxKind =
  | "earn"
  | "redeem"
  | "adjust"
  | "reverse_earn"
  | "reverse_redeem"
  | "birthday"
  | "expire";

interface LoyaltyTx {
  id: number;
  kind: TxKind;
  points: number;
  note: string | null;
  created_at: string;
  customers: { full_name: string } | null;
}

interface TopMember {
  points_balance: number;
  customers: { full_name: string } | null;
}

const KIND_META: Record<TxKind, { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  earn: { label: "Earned", tone: "success" },
  redeem: { label: "Redeemed", tone: "info" },
  adjust: { label: "Adjustment", tone: "warning" },
  reverse_earn: { label: "Earn reversed", tone: "danger" },
  reverse_redeem: { label: "Redeem returned", tone: "neutral" },
  birthday: { label: "Birthday", tone: "success" },
  expire: { label: "Expired", tone: "neutral" },
};

export default async function LoyaltyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "loyalty.manage")) {
    redirect("/dashboard");
  }

  let cfg: LoyaltyConfig = {};
  let txs: LoyaltyTx[] = [];
  let top: TopMember[] = [];

  if (!session.preview) {
    const supabase = await createClient();
    const [s, t, m] = await Promise.all([
      supabase.from("settings").select("value").eq("key", "loyalty").maybeSingle(),
      supabase
        .from("loyalty_transactions")
        .select("id, kind, points, note, created_at, customers(full_name)")
        .order("id", { ascending: false })
        .limit(100),
      supabase
        .from("loyalty_accounts")
        .select("points_balance, customers(full_name)")
        .gt("points_balance", 0)
        .order("points_balance", { ascending: false })
        .limit(10),
    ]);
    cfg = (s.data?.value as LoyaltyConfig | undefined) ?? {};
    txs = (t.data as unknown as LoyaltyTx[] | null) ?? [];
    top = (m.data as unknown as TopMember[] | null) ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Loyalty"
        description="Fully digital points program. Points post after payment and reverse on refunds and voids."
        actions={
          <Link
            href="/settings"
            className="text-sm text-latte underline-offset-2 hover:text-roast hover:underline"
          >
            Edit rules in Settings
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Recent activity" description="Latest 100 loyalty ledger entries." />
            <CardBody>
              {txs.length === 0 ? (
                <EmptyState
                  title="No loyalty activity yet"
                  description="Points earned and redeemed at the POS will appear here."
                />
              ) : (
                <Table>
                  <THead>
                    <TH>When</TH>
                    <TH>Member</TH>
                    <TH>Type</TH>
                    <TH className="text-right">Points</TH>
                    <TH>Note</TH>
                  </THead>
                  <TBody>
                    {txs.map((tx) => {
                      const meta = KIND_META[tx.kind];
                      const pts = Number(tx.points);
                      return (
                        <TR key={tx.id}>
                          <TD className="whitespace-nowrap text-latte">
                            {formatDateTime(tx.created_at)}
                          </TD>
                          <TD className="text-espresso">
                            {tx.customers?.full_name ?? "—"}
                          </TD>
                          <TD>
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                          </TD>
                          <TD
                            className={
                              pts < 0
                                ? "text-right font-medium text-danger"
                                : "text-right font-medium text-court-deep"
                            }
                          >
                            {pts > 0 ? "+" : ""}
                            {formatQty(pts)}
                          </TD>
                          <TD className="text-latte">{tx.note || "—"}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Program rules" />
            <CardBody>
              <div className="mb-3">
                <Badge tone={cfg.enabled ? "success" : "neutral"}>
                  {cfg.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <dl className="space-y-2 text-sm">
                <Rule label="Earn rate" value={`${formatQty(cfg.points_per_peso ?? 0)} pt / ₱1`} />
                <Rule label="Minimum purchase" value={formatPeso(cfg.min_purchase ?? 0)} />
                <Rule
                  label="Redemption value"
                  value={`${formatPeso(cfg.redemption_value_per_point ?? 0)} / pt`}
                />
                <Rule
                  label="Max redemption"
                  value={`${Math.round((cfg.max_redemption_pct ?? 0) * 100)}% of order`}
                />
                <Rule label="Points expiry" value={`${cfg.points_expiry_days ?? 0} days`} />
                <Rule label="Birthday bonus" value={`${formatQty(cfg.birthday_bonus_points ?? 0)} pts`} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Top members" description="By current balance." />
            <CardBody>
              {top.length === 0 ? (
                <p className="text-sm text-latte">No members with points yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {top.map((m, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-roast">{m.customers?.full_name ?? "—"}</span>
                      <Badge tone="success">{formatQty(Number(m.points_balance))} pts</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-roast">{label}</dt>
      <dd className="font-medium text-espresso">{value}</dd>
    </div>
  );
}
