"use client";

import { BarcodeScanner } from "@/components/barcode-scanner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState } from "react";

/**
 * Barcode text input with a "Scan" button — opens the camera, fills the
 * field from the first read, and closes. Used anywhere staff would
 * otherwise be retyping a barcode off a physical product (new inventory
 * items, new retail products).
 */
export function BarcodeField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [scanning, setScanning] = useState(false);

  return (
    <>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1" />
        <Button type="button" variant="outline" onClick={() => setScanning(true)}>
          Scan
        </Button>
      </div>

      {scanning && (
        <Dialog
          open
          onClose={() => setScanning(false)}
          title="Scan barcode"
          description="Point the camera at the product's barcode."
        >
          <BarcodeScanner
            active={scanning}
            onDetect={(code) => {
              onChange(code);
              setScanning(false);
            }}
          />
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="ghost" onClick={() => setScanning(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
