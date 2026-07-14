"use client";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { DIMENSIONS, RANGE_OPTIONS, type RangeKey, toCSV } from "@/lib/reports";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function ReportsControls({
  rangeKey,
  fromDate,
  toDate,
  dim,
  csv,
}: {
  rangeKey: RangeKey;
  fromDate: string;
  toDate: string;
  dim: string;
  /** Data for the CSV export of the currently shown breakdown. */
  csv: { filename: string; headers: string[]; rows: (string | number)[][] };
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

  function exportCSV() {
    const content = toCSV(csv.headers, csv.rows);
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csv.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mb-5 space-y-3 print:hidden">
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
          <Button
            variant="outline"
            onClick={() => push({ range: "custom", from, to })}
          >
            Apply
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value={dim}
          onChange={(e) => push({ dim: e.target.value })}
          className="max-w-52"
        >
          {DIMENSIONS.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="outline" onClick={exportCSV} disabled={csv.rows.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>
    </div>
  );
}
