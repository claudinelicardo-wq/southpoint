"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";

export function DayReceiptActions() {
  return (
    <div className="no-print flex items-center gap-3">
      <Button onClick={() => window.print()}>Print</Button>
      <Link
        href="/orders"
        className="text-sm text-latte underline-offset-2 hover:text-roast hover:underline"
      >
        Back to orders
      </Link>
    </div>
  );
}
