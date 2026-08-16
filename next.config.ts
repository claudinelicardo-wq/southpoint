import type { NextConfig } from "next";

// Standard security headers for a money-handling app. HSTS is already added by
// the host; these cover clickjacking, MIME sniffing, referrer leakage, and
// unused browser features. A full CSP is intentionally omitted for now (Next's
// inline runtime needs careful nonce handling) and left as a later hardening.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    // camera=(self): the POS barcode scanner needs it; still blocked for any
    // third-party iframe. Microphone/geolocation stay off — nothing uses them.
    value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
