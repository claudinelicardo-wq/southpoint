import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { AuditLog, Profile } from "@/lib/types";
import { redirect } from "next/navigation";

export const metadata = { title: "Audit Logs" };

export default async function AuditLogsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.permissions, session.profile.role, "audit.view")) {
    redirect("/dashboard");
  }

  let logs: (AuditLog & { profiles: Pick<Profile, "full_name"> | null })[] = [];
  if (!session.preview) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("audit_logs")
      .select("*, profiles(full_name)")
      .order("id", { ascending: false })
      .limit(200);
    logs = data ?? [];
  }

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Immutable record of sensitive actions. Newest first, latest 200 shown."
      />
      {logs.length === 0 ? (
        <EmptyState
          title="No audit entries yet"
          description="Sensitive actions (settings changes, role changes, voids, refunds, stock adjustments) are recorded here automatically."
        />
      ) : (
        <Table>
          <THead>
            <TH>When</TH>
            <TH>Who</TH>
            <TH>Action</TH>
            <TH>Entity</TH>
            <TH>Reason</TH>
          </THead>
          <TBody>
            {logs.map((log) => (
              <TR key={log.id}>
                <TD className="whitespace-nowrap text-latte">
                  {formatDateTime(log.created_at)}
                </TD>
                <TD>{log.profiles?.full_name ?? "System"}</TD>
                <TD>
                  <Badge tone="info">{log.action}</Badge>
                </TD>
                <TD className="text-roast">
                  {log.entity}
                  {log.entity_id ? ` · ${log.entity_id}` : ""}
                </TD>
                <TD className="text-latte">{log.reason ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
