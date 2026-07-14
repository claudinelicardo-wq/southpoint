import type { Metadata, Viewport } from "next";
import { DM_Sans, Fredoka } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

// Rounded, groovy display face that echoes the logo's bubble lettering.
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "South Point Cafe & Lounge",
    template: "%s · South Point",
  },
  description:
    "Operations system for South Point Cafe & Lounge: POS, inventory, purchasing, shifts, loyalty, and reports.",
  applicationName: "South Point",
};

export const viewport: Viewport = {
  themeColor: "#3a4fbf",
  width: "device-width",
  initialScale: 1,
};

// Origin of the Supabase project, if configured. Every authenticated page's
// first action is a request here, so we warm the connection (DNS + TCP + TLS)
// ahead of time to take it off the critical path. React 19 hoists these hints
// into <head> and dedupes them.
function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const origin = supabaseOrigin();
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${fredoka.variable} h-full antialiased`}
    >
      {origin && (
        <>
          <link rel="preconnect" href={origin} crossOrigin="anonymous" />
          <link rel="dns-prefetch" href={origin} />
        </>
      )}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
