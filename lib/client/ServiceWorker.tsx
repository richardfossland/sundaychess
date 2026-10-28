"use client";

import { useEffect, useRef, useState } from "react";
import { no } from "@/lib/locale/no";

// Registers /sw.js (production only). A new worker WAITS: it never takes over a
// running tournament by itself — the user taps the banner (or reloads after all
// tabs close). Playwright blocks service workers by default (playwright.config).
export function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  // Reload ONLY after the user asked for the update (first-install claim must not reload).
  const wantsUpdate = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    let reloading = false;
    const onController = () => {
      if (reloading || !wantsUpdate.current) return;
      reloading = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // Only a REPLACEMENT is interesting: no controller = first install.
        const check = (w: ServiceWorker | null) => {
          if (w && w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w);
        };
        check(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          w?.addEventListener("statechange", () => check(w));
        });
      })
      .catch(() => {});
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onController);
  }, []);

  if (!waiting) return null;
  return (
    <div
      role="status"
      style={{ position: "fixed", left: 12, bottom: 12, zIndex: 60, maxWidth: "calc(100vw - 24px)" }}
    >
      <button
        type="button"
        className="btn btn-primary"
        title={no.pwa.updateHint}
        onClick={() => {
          wantsUpdate.current = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        {no.pwa.updateAvailable}
      </button>
    </div>
  );
}
