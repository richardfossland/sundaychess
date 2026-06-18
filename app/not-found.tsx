import Link from "next/link";
import { no } from "@/lib/locale/no";

// Branded 404 — replaces Next's bare default with the suite look (brandmark,
// gold accent, ≥44px touch targets) so a stale/typo'd link lands somewhere warm.
export default function NotFound() {
  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center" style={{ alignItems: "center" }}>
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>
        <div style={{ fontSize: 40 }}>♟️</div>
        <h2 style={{ fontSize: 24 }}>{no.common.notFoundTitle}</h2>
        <p className="muted" style={{ maxWidth: 360 }}>{no.common.notFoundBody}</p>
        <div className="row" style={{ marginTop: 6, justifyContent: "center" }}>
          <Link href="/" className="btn btn-primary btn-lg">
            {no.common.home}
          </Link>
          <Link href="/play" className="btn btn-lg">
            {no.player?.join ?? "Bli med"}
          </Link>
        </div>
      </div>
    </main>
  );
}
