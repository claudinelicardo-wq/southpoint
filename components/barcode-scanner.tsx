"use client";

import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";

/**
 * Continuous camera barcode/QR scanner. Uses ZXing's pure-JS decoder (frame
 * grabs off a <video> via canvas) rather than the native BarcodeDetector API
 * — Safari/iPadOS support for that API is inconsistent, and this is the
 * device the POS actually runs on.
 *
 * Calls onDetect for every decode; the caller debounces repeats (e.g. by
 * ignoring the same code for a couple seconds) since this fires continuously
 * while a code sits in frame.
 */
export function BarcodeScanner({
  onDetect,
  active,
}: {
  onDetect: (text: string) => void;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onDetectRef = useRef(onDetect);
  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    if (!active || !videoRef.current) return;
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | null = null;
    let cancelled = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        (result) => {
          if (result) onDetectRef.current(result.getText());
        },
      )
      .then((c) => {
        if (cancelled) c.stop();
        else controls = c;
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't access the camera. Check camera permission for this site.");
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [active]);

  if (error) {
    return <p className="p-4 text-center text-sm text-danger">{error}</p>;
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
      <div className="pointer-events-none absolute inset-x-10 top-1/2 h-0.5 -translate-y-1/2 bg-court/80" />
    </div>
  );
}
