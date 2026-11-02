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
        <p className="muted landing-lede reveal" style={r(4)}>
          En sjakkturnering for hele gruppa. Arrangøren viser turneringen på
          storskjermen, spillerne blir med med en PIN — med konger og bønder.
        </p>

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

        {/* "Slik funker det" — a plain 3-step strip so a first-time visitor
            (who has never seen a tournament PIN before) knows what they're
            about to click into, plus the reassurance line addressing the
            usual teacher worries (cost, accounts, device support, time). */}
        <div className="how reveal" style={r(7)}>
          <p className="eyebrow">{no.landing.howTitle}</p>
          <div className="how-steps">
            <span className="faint">1. {no.landing.step1}</span>
            <span className="muted">→</span>
            <span className="faint">2. {no.landing.step2}</span>
            <span className="muted">→</span>
            <span className="faint">3. {no.landing.step3}</span>
          </div>
          <p className="faint how-note">{no.landing.reassurance}</p>
        </div>

        {/* Discreet entry to the OPTIONAL Sunday Account host dashboard.
            Anonymous arrangører use "Jeg arrangerer" above and never need to
            sign in. */}
        <Link href="/host" className="text-link reveal" style={r(8)}>
          {no.hostAuth.landingLink}
        </Link>
        <Link href="/personvern" className="text-link text-link-quiet reveal" style={r(9)}>
          {no.privacy.link}
        </Link>
      </div>
    </main>
  );
}
