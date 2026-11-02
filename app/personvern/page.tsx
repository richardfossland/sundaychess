import type { Metadata } from "next";
import { no } from "@/lib/locale/no";
import { PageHeader } from "@/lib/client/PageHeader";

export const metadata: Metadata = {
  title: `${no.privacy.title} · SundayChess`,
};

// Statisk side, ingen database. Tallene (14 dager / 30 dager) speiler
// docs/TELEMETRY.md og supabase/migrations/0012 og 0016.
export default function PersonvernPage() {
  const p = no.privacy;
  return (
    <main className="center-screen">
      <div className="privacy-page">
        <PageHeader backHref="/" backLabel={p.back} />
        <h1 className="fs-xl">{p.title}</h1>
        <p className="muted">{p.lede}</p>

        <h2>{p.collectedTitle}</h2>
        <p>{p.collectedIntro}</p>
        <ul>
          {p.collected.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        <h2>{p.notCollectedTitle}</h2>
        <ul>
          {p.notCollected.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        <h2>{p.retentionTitle}</h2>
        <p>{p.retention}</p>

        <h2>{p.cookiesTitle}</h2>
        <p>{p.cookies}</p>

        <h2>{p.physicalTitle}</h2>
        {p.physical.map((t) => (
          <p key={t}>{t}</p>
        ))}

        <h2>{p.contactTitle}</h2>
        <p>{p.contact}</p>
      </div>
    </main>
  );
}
