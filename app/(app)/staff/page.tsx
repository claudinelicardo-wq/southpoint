import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { redirect } from "next/navigation";
import { StaffManager } from "./staff-manager";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "staff.manage")) {
    redirect("/dashboard");
  }

  let staff: Profile[] = [];
  if (!session.preview) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at");
    staff = data ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Create staff accounts, assign roles, and deactivate former staff. Every change is audited."
      />
      <StaffManager staff={staff} selfId={session.profile.id} preview={session.preview} />
    </div>
  );
}
