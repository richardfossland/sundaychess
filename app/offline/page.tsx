import { no } from "@/lib/locale/no";
import { OfflineRetry } from "./OfflineRetry";

// Served by the service worker (public/sw.js) when a navigation fails offline
// and is not under /arranger/fysisk. Static: precached at install.
export default function OfflinePage() {
  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center" style={{ alignItems: "center" }}>
        <div style={{ fontSize: 40 }}>♟️</div>
        <h2 style={{ fontSize: 24 }}>{no.pwa.offlineTitle}</h2>
        <p className="muted" style={{ maxWidth: 380 }}>{no.pwa.offlineBody}</p>
        <OfflineRetry label={no.pwa.offlineRetry} />
      </div>
    </main>
  );
}
