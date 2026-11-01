import Link from "next/link";
import { no } from "@/lib/locale/no";
import { PageHeader } from "@/lib/client/PageHeader";

// Branded 404 — replaces Next's bare default with the suite look (brandmark,
// gold accent, ≥44px touch targets) so a stale/typo'd link lands somewhere warm.
export default function NotFound() {
  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center align-center">
        <PageHeader />
        <div className="status-glyph">♟️</div>
        <h2 className="fs-xl">{no.common.notFoundTitle}</h2>
        <p className="muted status-copy">{no.common.notFoundBody}</p>
        <div className="row status-actions">
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
