"use client";

import { cn } from "@/lib/cn";
import { visibleNav, type NavItem } from "@/lib/permissions";
import type { Profile } from "@/lib/types";
import { ROLE_LABELS } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Wordmark } from "./wordmark";
import { LogOut, Menu, Wifi, WifiOff } from "lucide-react";

const SECTION_LABELS: Record<NavItem["section"], string> = {
  operate: "Operate",
  manage: "Manage",
  money: "Money",
  admin: "Admin",
};

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function AppShell({
  profile,
  permissions,
  preview,
  children,
}: {
  profile: Profile;
  permissions: string[];
  preview: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const online = useOnline();
  const drawerRef = useRef<HTMLElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Mobile drawer: lock scroll, move focus in, close on Escape, and return
  // focus to the trigger when it closes.
  useEffect(() => {
    if (!mobileOpen) return;
    const trigger = menuBtnRef.current; // stable node; focus returns here on close
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [mobileOpen]);

  const nav = useMemo(
    () => visibleNav(profile.role, new Set(permissions)),
    [profile.role, permissions],
  );

  const sections = useMemo(() => {
    const grouped = new Map<NavItem["section"], NavItem[]>();
    for (const item of nav) {
      const list = grouped.get(item.section) ?? [];
      list.push(item);
      grouped.set(item.section, list);
    }
    return [...grouped.entries()];
  }, [nav]);

  async function signOut() {
    if (isSupabaseConfigured) {
      await createClient().auth.signOut();
    }
    router.push("/login");
    router.refresh();
  }

  const navBody = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {sections.map(([section, items]) => (
        <div key={section}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-latte">
            {SECTION_LABELS[section]}
          </p>
          <ul className="space-y-0.5">
            {items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "tap block rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-court-soft text-court-deep"
                        : "text-roast hover:bg-sand",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh w-full">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-paper lg:flex">
        <div className="border-b border-line px-5 py-4">
          <Wordmark size="sm" />
        </div>
        {navBody}
        <div className="border-t border-line p-3">
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-espresso">
                {profile.full_name || "Staff"}
              </p>
              <p className="text-xs text-latte">{ROLE_LABELS[profile.role]}</p>
            </div>
            <button
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
              className="rounded-lg p-2 text-latte hover:bg-sand hover:text-roast"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-espresso/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            ref={drawerRef}
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-72 flex-col bg-paper shadow-xl outline-none"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <Wordmark size="sm" />
            </div>
            {navBody}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-cream/90 px-4 py-3 backdrop-blur lg:px-8">
          <button
            ref={menuBtnRef}
            className="rounded-lg p-2 text-roast hover:bg-sand lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-controls="mobile-nav"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-5" />
          </button>
          <div className="lg:hidden">
            <Wordmark size="sm" />
          </div>
          <div className="ml-auto flex items-center gap-3">
            {preview && (
              <span className="rounded-full bg-amber-soft px-3 py-1 text-xs font-semibold text-amber">
                UI preview — no database connected
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium",
                online ? "text-grass-deep" : "text-danger",
              )}
              title={online ? "Online" : "Offline — sales cannot be posted"}
            >
              {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
              {online ? "Online" : "Offline"}
            </span>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
