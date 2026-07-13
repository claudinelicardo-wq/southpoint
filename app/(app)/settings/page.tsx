import { PageHeader } from "@/components/ui/card";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { SettingRow } from "@/lib/types";
import { redirect } from "next/navigation";
import { SettingsForms } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "settings.manage")) {
    redirect("/dashboard");
  }

  let settings: SettingRow[] = [];
  if (!session.preview) {
    const supabase = await createClient();
    const { data } = await supabase.from("settings").select("*").order("key");
    settings = (data ?? []) as SettingRow[];
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="Business configuration. Changes are audited. Keys marked owner-only can only be changed by the owner."
      />
      <SettingsForms
        settings={settings}
        isOwner={session.profile.role === "owner"}
        preview={session.preview}
      />
    </div>
  );
}
