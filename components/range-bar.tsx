"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/reports";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/** Date-range preset bar (presets + custom + print). Drives the ?range/?from/?to
 *  search params that a server page reads via resolveRange. */
export function RangeBar({
  rangeKey,
  fromDate,
  toDate,
}: {
  rangeKey: RangeKey;
  fromDate: string;
  toDate: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [from, setFrom] = useState(fromDate);
  const [to, setTo] = useState(toDate);

  function push(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="mb-5 space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => push({ range: r.key })}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                rangeKey === r.key
                  ? "bg-court text-white"
                  : "border border-line bg-paper text-roast hover:border-latte",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      {rangeKey === "custom" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-roast">
            <span className="mb-1 block text-xs text-latte">From</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm text-roast">
            <span className="mb-1 block text-xs text-latte">To</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button variant="outline" onClick={() => push({ range: "custom", from, to })}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
