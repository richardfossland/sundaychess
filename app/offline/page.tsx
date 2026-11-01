import { no } from "@/lib/locale/no";
import { OfflineRetry } from "./OfflineRetry";

// Served by the service worker (public/sw.js) when a navigation fails offline
// and is not under /arranger/fysisk. Static: precached at install.
export default function OfflinePage() {
  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center align-center">
        <div className="brandmark">
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>
        <div className="status-glyph">♟️</div>
        <h2 className="fs-xl">{no.pwa.offlineTitle}</h2>
        <p className="muted status-copy">{no.pwa.offlineBody}</p>
        <OfflineRetry label={no.pwa.offlineRetry} />
      </div>
    </main>
  );
}
