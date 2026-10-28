import type { MetadataRoute } from "next";
import { no } from "@/lib/locale/no";

// Colours = design tokens in app/globals.css (--ink for the dark surface).
const INK = "#11141b";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: no.appName,
    short_name: no.appName,
    description: no.pwa.description,
    lang: "nb",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: INK,
    background_color: INK,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
