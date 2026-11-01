import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { OfflineBanner } from "@/lib/client/OfflineBanner";
import { ServiceWorker } from "@/lib/client/ServiceWorker";
import { ThemeToggle } from "@/lib/client/ThemeToggle";

// Resolve dark/light before paint (stored choice → system fallback) to avoid a
// flash. Sets data-theme on <html>; globals.css keys the light overrides off it.
const themeScript = `(function(){try{var t=localStorage.getItem('chess:theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

// Suite brand fonts, bundled in the repo (variable woff2, latin subset, OFL-1.1) so
// builds never depend on fonts.googleapis.com. Licences in app/fonts/ and THIRD-PARTY-NOTICES.md.
const display = localFont({
  src: "./fonts/playfair-display-latin-wght-normal.woff2",
  variable: "--font-display",
  weight: "400 900",
  display: "swap",
});
const body = localFont({
  src: "./fonts/hanken-grotesk-latin-wght-normal.woff2",
  variable: "--font-body",
  weight: "100 900",
  display: "swap",
});

export const viewport: Viewport = { themeColor: "#11141b" };

export const metadata: Metadata = {
  title: "SundayChess — sjakkturnering for hele gruppa",
  description:
    "Sjakkturnering på storskjerm med liga, sluttspill, lag og lynsjakk. Arrangøren styrer storskjermen, og spillerne blir med med en PIN.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="no" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <OfflineBanner />
        {children}
        <ThemeToggle />
        <ServiceWorker />
      </body>
    </html>
  );
}
