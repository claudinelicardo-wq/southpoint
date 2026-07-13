import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getSession } from "@/lib/session";
import { can, visibleNav } from "@/lib/permissions";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { profile, permissions } = session;

  const quickLinks = visibleNav(profile.role, permissions).filter((n) =>
    ["/pos", "/kds", "/inventory", "/purchasing", "/reports", "/shifts"].includes(n.href),
  );

  const hour = Number(
    new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${profile.full_name.split(" ")[0] || "there"}`}
        description="Here's what's happening at South Point today."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="tap rounded-(--radius-card) border border-line bg-paper px-4 py-5 text-center font-medium text-roast shadow-(--shadow-card) transition-colors hover:border-court hover:text-court-deep"
          >
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <EmptyState
              title="Sales overview coming online"
              description={
                can(permissions, profile.role, "reports.sales")
                  ? "Today's sales, order counts, and payment breakdowns will appear here once the POS module records its first sale."
                  : "Your shift summary will appear here once you open a shift."
              }
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <EmptyState
              title="Stock alerts"
              description="Low-stock, out-of-stock, and expiring inventory will appear here once inventory items are set up."
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
