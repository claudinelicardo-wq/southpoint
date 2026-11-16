"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

/** Shows the public link for a customer-facing path with copy + open buttons. */
export function ShareLink({ path, label }: { path: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-line bg-cream px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-espresso">{label}</p>
        <p className="truncate font-mono text-xs text-latte" suppressHydrationWarning>
          {url}
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? "Copied!" : "Copy link"}
        </Button>
        <a
          href={path}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-roast hover:bg-sand"
        >
          Open
        </a>
      </div>
    </div>
  );
}
