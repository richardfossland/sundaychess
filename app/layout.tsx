import type { Metadata } from "next";
import { Playfair_Display, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { OfflineBanner } from "@/lib/client/OfflineBanner";
import { ThemeToggle } from "@/lib/client/ThemeToggle";

// Resolve dark/light before paint (stored choice → system fallback) to avoid a
// flash. Sets data-theme on <html>; globals.css keys the light overrides off it.
const themeScript = `(function(){try{var t=localStorage.getItem('chess:theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

// Suite brand fonts.
const display = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["700", "800"],
});
const body = Hanken_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SundayChess — sjakkturnering for hele gruppa",
  description:
    "Sjakkturnering på storskjerm med liga, sluttspill, lag og lynsjakk. Arrangøren styrer tavla, spillerne blir med med en PIN.",
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
      </body>
    </html>
  );
}
