"use client";

import { useEffect, useSyncExternalStore } from "react";
import { no } from "@/lib/locale/no";
import {
  getConnectivity,
  isDegraded,
  setOnline,
  subscribeConnectivity,
} from "@/lib/client/connectivity";

const SERVER: ReturnType<typeof getConnectivity> = { failures: 0, lastOkAt: null, online: true };

/** Shown when the browser is offline or two requests in a row have failed. The
 * last good state stays on screen underneath — a board must never go blank on
 * flaky wifi. Mounted once in the root layout. */
export function OfflineBanner() {
  const c = useSyncExternalStore(subscribeConnectivity, getConnectivity, () => SERVER);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine !== false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (!isDegraded(c)) return null;
  const t = c.lastOkAt
    ? new Date(c.lastOkAt).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      {t ? no.common.offlineSince(t) : no.common.offlineRetrying}
    </div>
  );
}
