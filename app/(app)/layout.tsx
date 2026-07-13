import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AppShell
      profile={session.profile}
      permissions={[...session.permissions]}
      preview={session.preview}
    >
      {children}
    </AppShell>
  );
}
