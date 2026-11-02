import type { Metadata } from "next";
import { no } from "@/lib/locale/no";
import { PageHeader } from "@/lib/client/PageHeader";

export const metadata: Metadata = {
  title: `${no.privacy.title} · SundayChess`,
};

// Statisk side, ingen database. Tallene speiler migrasjonene: 14 dager (0012),
// 30 dager / 2 dager / 7 dager casual (0004, 0010, 0013), ca. ett døgn for
// code_attempts (0015), 30 dager fysisk (0016). Endres en frist: endre teksten.
export default function PersonvernPage() {
  const p = no.privacy;
  return (
    <main className="center-screen">
      <div className="privacy-page">
        <PageHeader backHref="/" backLabel={p.back} />
        <h1 className="fs-xl">{p.title}</h1>
        <p className="muted">{p.lede}</p>

        <h2>{p.whoTitle}</h2>
        {p.who.map((t) => (
          <p key={t}>{t}</p>
        ))}

        <h2>{p.digitalTitle}</h2>
        <p>{p.digitalIntro}</p>
        <ul>
          {p.digital.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p>{p.digitalRetention}</p>

        <h2>{p.ipTitle}</h2>
        {p.ip.map((t) => (
          <p key={t}>{t}</p>
        ))}

        <h2>{p.collectedTitle}</h2>
        <p>{p.collectedIntro}</p>
        <ul>
          {p.collected.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p>{p.collectedNote}</p>

        <h2>{p.notCollectedTitle}</h2>
        <ul>
          {p.notCollected.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        <h2>{p.physicalTitle}</h2>
        {p.physical.map((t) => (
          <p key={t}>{t}</p>
        ))}

        <h2>{p.cookiesTitle}</h2>
        {p.cookies.map((t) => (
          <p key={t}>{t}</p>
        ))}

        <h2>{p.contactTitle}</h2>
        <p>{p.contact}</p>
      </div>
    </main>
  );
}
