import Link from "next/link";
import { no } from "@/lib/locale/no";

export default function Landing() {
  return (
    <main className="center-screen">
      <div className="stack text-center" style={{ alignItems: "center", maxWidth: 560 }}>
        <p className="eyebrow">{no.tagline}</p>
        <h1 style={{ fontSize: "clamp(44px, 9vw, 88px)" }}>
          Sunday<span style={{ color: "var(--gold)" }}>Sjakk</span>
        </h1>
        <p className="muted" style={{ maxWidth: 420 }}>
          En sjakkturnering for hele klassen. Læreren styrer tavla, elevene blir
          med med en PIN — akkurat som Kahoot.
        </p>
        <div
          className="row"
          style={{ marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}
        >
          <Link className="btn btn-primary btn-lg" href="/host">
            {no.landing.teacher}
          </Link>
          <Link className="btn btn-lg" href="/play">
            {no.landing.student}
          </Link>
        </div>
      </div>
    </main>
  );
}
