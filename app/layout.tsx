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
    "Operations system for South Point Cafe & Lounge — POS, inventory, purchasing, shifts, loyalty, and reports.",
  applicationName: "South Point",
};

export const viewport: Viewport = {
  themeColor: "#3a4fbf",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${fredoka.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
