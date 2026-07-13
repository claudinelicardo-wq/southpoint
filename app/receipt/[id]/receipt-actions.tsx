"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export function ReceiptActions({ orderId }: { orderId: string }) {
  function handlePrint() {
    // Fire-and-forget reprint audit — never block or fail the print itself.
    const supabase = createClient();
    void supabase
      .rpc("log_receipt_reprint", { p_order: orderId })
      .then(undefined, () => {});
    window.print();
  }

  return (
    <div className="no-print flex items-center gap-3">
      <Button onClick={handlePrint}>Print</Button>
      <Link
        href={`/orders/${orderId}`}
        className="text-sm text-latte underline-offset-2 hover:text-roast hover:underline"
      >
        Back to order
      </Link>
    </div>
  );
}
