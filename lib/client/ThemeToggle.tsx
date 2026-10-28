"use client";

import { useEffect, useState } from "react";
import { no } from "@/lib/locale/no";

type Theme = "light" | "dark";
const KEY = "chess:theme";

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Floating dark/light switch. The initial theme is set before paint by the
 * inline script in layout.tsx (reads localStorage, falls back to system); this
 * only flips + persists it. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync to the pre-paint theme
    setTheme(current());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    setTheme(next);
  }

  // Avoid a hydration mismatch on the icon: render a neutral button until mounted.
  const isDark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? no.common.themeToLight : no.common.themeToDark}
      title={isDark ? no.common.themeLight : no.common.themeDark}
      suppressHydrationWarning
    >
      {!mounted ? null : isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
