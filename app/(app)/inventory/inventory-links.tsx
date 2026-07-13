import { cn } from "@/lib/cn";
import Link from "next/link";

const TABS = [
  { key: "items", label: "Items", href: "/inventory" },
  { key: "waste", label: "Waste", href: "/inventory/waste" },
  { key: "counts", label: "Counts", href: "/inventory/counts" },
] as const;

export type InventoryTab = (typeof TABS)[number]["key"];

/** Small tab-style links between the inventory workflows. */
export function InventoryTabs({ active }: { active: InventoryTab }) {
  return (
    <nav aria-label="Inventory sections" className="mb-4 flex gap-1.5">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
            active === t.key
              ? "bg-espresso text-cream"
              : "bg-sand text-roast hover:bg-line",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
