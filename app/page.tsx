import Link from "next/link";
import type { CSSProperties } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";

// helper: stagger index as a CSS custom property
const r = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

export default function Landing() {
  return (
    <main className="center-screen">
      <div className="landing">
        <div className="landing-glyph reveal float" style={r(0)}>
          ♞
        </div>
        <p className="eyebrow reveal" style={r(1)}>
          {no.tagline}
        </p>
        <h1 className="landing-title reveal" style={r(2)}>
          Sunday<span className="title-gold">Chess</span>
        </h1>
        <hr className="thread landing-thread reveal" style={r(3)} />

        {/* two entrances */}
        <div className="entrances reveal" style={r(5)}>
          <Link href="/arranger" className="card entrance entrance-card">
            <span className="entrance-glyph">♚</span>
            <b className="entrance-title">{no.landing.teacher}</b>
            <span className="entrance-sub">{no.landing.teacherSub}</span>
          </Link>
          <Link href="/play" className="card entrance entrance-card">
            <span className="entrance-glyph">♟</span>
            <b className="entrance-title">{no.landing.student}</b>
            <span className="entrance-sub">{no.landing.studentSub}</span>
          </Link>
        </div>

        <div className="landing-links reveal" style={r(6)}>
          <Link href="/versus" className="btn btn-ghost">
            <Icon name="versus" size={18} /> {no.landing.versus}
          </Link>
          <Link href="/solo" className="btn btn-ghost">
            ♟ {no.solo.cta}
          </Link>
        </div>

        {/* "Slik funker det" — three icon tiles instead of a sentence. */}
        <div className="how reveal" style={r(7)}>
          <p className="eyebrow">{no.landing.howTitle}</p>
          <ol className="feature-tiles">
            {(
              [
                ["crown", no.landing.step1],
                ["qr", no.landing.step2],
                ["monitor", no.landing.step3],
              ] as const
            ).map(([icon, label], i) => (
              <li key={icon} className="feature-tile">
                <span className="feature-step">{i + 1}</span>
                <Icon name={icon} size={26} />
                {label}
              </li>
            ))}
          </ol>
        </div>

        <Link href="/personvern" className="text-link text-link-quiet reveal" style={r(8)}>
          {no.privacy.link}
        </Link>
      </div>
    </main>
  );
}
