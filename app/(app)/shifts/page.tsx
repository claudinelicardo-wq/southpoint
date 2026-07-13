import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  ShiftsManager,
  type CashMovementRow,
  type ClosedShiftRow,
  type ShiftRow,
} from "./shifts-manager";

export const metadata = { title: "Shifts" };

export default async function ShiftsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canOwn = can(session.permissions, session.profile.role, "shifts.own");
  const canManage = can(session.permissions, session.profile.role, "shifts.manage");
  if (!canOwn && !canManage) redirect("/dashboard");

  let openShift: ShiftRow | null = null;
  let movements: CashMovementRow[] = [];
  let closedShifts: ClosedShiftRow[] = [];
  let showExpectedSetting = false;

  if (!session.preview) {
    const supabase = await createClient();
    const [shift, closed, setting] = await Promise.all([
      supabase
        .from("shifts")
        .select("*")
        .eq("cashier_id", session.profile.id)
        .eq("status", "open")
        .maybeSingle<ShiftRow>(),
      // RLS already limits cashiers to their own shifts.
      supabase
        .from("shifts")
        .select("*, profiles(full_name)")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(30),
      supabase.from("settings").select("value").eq("key", "shifts").maybeSingle(),
    ]);
    openShift = shift.data ?? null;
    closedShifts = (closed.data as ClosedShiftRow[] | null) ?? [];
    showExpectedSetting = Boolean(
      (setting.data?.value as Record<string, unknown> | undefined)
        ?.show_expected_cash_before_count,
    );

    if (openShift) {
      const { data } = await supabase
        .from("cash_movements")
        .select("*")
        .eq("shift_id", openShift.id)
        .order("created_at", { ascending: false });
      movements = (data as CashMovementRow[] | null) ?? [];
    }
  }

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="Shifts"
          description="Open and close cash drawers, record paid-ins and paid-outs, and reconcile with a blind count."
        />
      </div>
      <ShiftsManager
        openShift={openShift}
        movements={movements}
        closedShifts={closedShifts}
        canOwn={canOwn}
        canViewExpected={can(
          session.permissions,
          session.profile.role,
          "shifts.view_expected_cash",
        )}
        showExpectedSetting={showExpectedSetting}
        preview={session.preview}
      />
    </div>
  );
}
