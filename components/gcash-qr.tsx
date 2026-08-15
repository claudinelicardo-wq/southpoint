"use client";

import { useState } from "react";

/**
 * GCash QR block shown in payment flows. Tapping the thumbnail opens a
 * full-screen overlay so the customer can scan from across the counter;
 * tapping anywhere closes it.
 */
export function GcashQr({ image }: { image: string | null }) {
  const [enlarged, setEnlarged] = useState(false);

  if (!image) {
    return (
      <div className="mt-3 rounded-lg bg-cream p-3">
        <p className="text-sm text-latte">
          No GCash QR code on file — add one in Settings → Receipt.
        </p>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        className="mt-3 flex w-full items-center gap-3 rounded-lg bg-cream p-3 text-left"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- data-URI image; next/image adds nothing here */}
        <img
          src={image}
          alt="GCash QR code"
          className="h-28 w-28 shrink-0 rounded-lg border border-line bg-white object-contain"
        />
        <span className="text-sm text-roast">
          Show this to the customer to scan in their GCash app.
          <span className="mt-1 block text-xs text-latte">Tap to enlarge</span>
        </span>
      </button>

      {enlarged && (
        <button
          type="button"
          onClick={() => setEnlarged(false)}
          aria-label="Close enlarged QR code"
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-black/80 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data-URI image */}
          <img
            src={image}
            alt="GCash QR code"
            className="max-h-[80vh] w-full max-w-xl rounded-2xl bg-white object-contain p-4"
          />
          <span className="text-sm font-medium text-white">Tap anywhere to close</span>
        </button>
      )}
    </>
  );
}
