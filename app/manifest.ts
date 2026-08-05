import type { MetadataRoute } from "next";

// PWA manifest — lets staff install South Point to the tablet home screen. It
// then launches full-screen and caches the app shell, so it opens instantly and
// feels like a native app rather than a browser tab.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "South Point Cafe & Lounge",
    short_name: "South Point",
    description:
      "Point of sale, inventory, and operations for South Point Cafe & Lounge.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "any",
    background_color: "#faf6ee",
    theme_color: "#3a4fbf",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
