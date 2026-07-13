"use client";

import { cn } from "@/lib/cn";
import { useEffect, useRef } from "react";
import { Button } from "./button";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
      className={cn(
        "m-auto w-full max-w-lg rounded-2xl border border-line bg-paper p-0 shadow-xl",
        "backdrop:bg-espresso/40 backdrop:backdrop-blur-[2px]",
        className,
      )}
    >
      <div className="px-6 py-5">
        <h2 className="font-display text-lg font-semibold text-espresso">{title}</h2>
        {description && <p className="mt-1 text-sm text-latte">{description}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}

/**
 * Confirmation dialog for destructive / financially sensitive actions.
 * Optionally requires a reason before confirming.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="text-sm text-roast">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
