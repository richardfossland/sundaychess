"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { no } from "@/lib/locale/no";
import { api, ApiError } from "@/lib/client/api";
import { identity, type StoredPlayer } from "@/lib/client/identity";
import { isValidPin } from "@/lib/codes";
import { normalizeBestOf } from "@/lib/duel/match";
import { DuelRoom } from "./DuelRoom";

type Screen = "loading" | "home" | "create" | "joinName" | "room";

const CLOCKS: { sec: number | null; label: string }[] = [
  { sec: null, label: no.duel.clockOff },
  { sec: 180, label: "3 min" },
  { sec: 300, label: "5 min" },
  { sec: 600, label: "10 min" },
];
const VARIANTS: { key: string; label: string }[] = [
  { key: "standard", label: no.wizard.variants.standard },
  { key: "no_queens", label: no.wizard.variants.no_queens },
  { key: "pawn_war", label: no.wizard.variants.pawn_war },
];

export default function DuelPage() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [me, setMe] = useState<StoredPlayer | null>(null);
  const [joinPin, setJoinPin] = useState("");
  const [name, setName] = useState("");
  const [bestOf, setBestOf] = useState(3);
  const [clockSec, setClockSec] = useState<number | null>(null);
  const [variant, setVariant] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: restore an active duel session, else honour a scanned ?j=PIN.
  useEffect(() => {
    const j = new URLSearchParams(window.location.search).get("j") ?? "";
    const scanned = isValidPin(j) ? j : "";
    const stored = identity.player();

    const decide = async () => {
      if (stored) {
        try {
          const board = await api.board(stored.tournamentId);
          if (board.tournament.config.format === "duel") {
            setMe(stored);
            setScreen("room");
            return;
          }
        } catch {
          // stale/non-duel identity → fall through
        }
      }
      if (scanned) {
        setJoinPin(scanned);
        setScreen("joinName");
      } else {
        setScreen("home");
      }
    };
    decide();
  }, []);

  async function doCreate() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createDuel({
        name: name.trim(),
        bestOf: normalizeBestOf(bestOf),
        clockSec,
        variant,
      });
      const stored: StoredPlayer = {
        tournamentId: r.tournamentId,
        playerId: r.playerId,
        resumeCode: r.resumeCode,
        displayName: r.displayName,
      };
      identity.savePlayer(stored);
      setMe(stored);
      setScreen("room");
    } catch {
      setError(no.common.error);
      setBusy(false);
    }
  }

  async function doJoin() {
    if (!name.trim() || !isValidPin(joinPin)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.joinDuel(joinPin, name.trim());
      const stored: StoredPlayer = {
        tournamentId: r.tournamentId,
        playerId: r.playerId,
        resumeCode: r.resumeCode,
        displayName: r.displayName,
      };
      identity.savePlayer(stored);
      setMe(stored);
      setScreen("room");
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setError(
        code === "duel_full"
          ? no.duel.full
          : code === "invalid_pin"
            ? no.duel.notFound
            : no.common.error,
      );
      setBusy(false);
    }
  }

  function exitToHome() {
    identity.clearPlayer();
    setMe(null);
    setName("");
    setJoinPin("");
    setError(null);
    setScreen("home");
    // drop any ?j= so a refresh doesn't bounce back into join
    window.history.replaceState(null, "", "/duel");
  }

  if (screen === "loading") {
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );
  }

  if (screen === "room" && me) {
    return <DuelRoom me={me} onExit={exitToHome} />;
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack">
        <div className="brandmark" style={{ justifyContent: "center", marginBottom: 2 }}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>

        <div key={screen} className="stack scale-in" style={{ gap: 16 }}>
          {screen === "home" && (
            <>
              <div className="text-center stack" style={{ gap: 6 }}>
                <div style={{ fontSize: 44 }}>⚔️</div>
                <p className="eyebrow">{no.duel.landingTitle}</p>
                <p className="faint" style={{ fontSize: 13 }}>{no.duel.landingSub}</p>
              </div>
              <button className="btn btn-primary btn-block btn-lg" onClick={() => setScreen("create")}>
                {no.duel.create} →
              </button>
              <Link href="/" className="btn btn-ghost btn-block">
                {no.common.back}
              </Link>
            </>
          )}

          {screen === "create" && (
            <>
              <p className="eyebrow">{no.duel.createTitle}</p>
              <div className="field">
                <label htmlFor="dn">{no.duel.yourName}</label>
                <input
                  id="dn"
                  className="input"
                  maxLength={40}
                  autoFocus
                  placeholder={no.duel.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && doCreate()}
                />
              </div>

              <div className="field">
                <label>{no.duel.bestOf}</label>
                <div className="row" style={{ gap: 8 }}>
                  {[1, 3, 5].map((n) => (
                    <button
                      key={n}
                      className={`btn grow ${bestOf === n ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setBestOf(n)}
                    >
                      {n === 1 ? no.duel.bestOf1 : n === 3 ? no.duel.bestOf3 : no.duel.bestOf5}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>{no.duel.clock}</label>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {CLOCKS.map((c) => (
                    <button
                      key={c.label}
                      className={`btn grow ${clockSec === c.sec ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setClockSec(c.sec)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>{no.duel.variant}</label>
                <div className="stack" style={{ gap: 8 }}>
                  {VARIANTS.map((v) => (
                    <button
                      key={v.key}
                      className={`btn btn-block ${variant === v.key ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setVariant(v.key)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="btn btn-primary btn-block btn-lg"
                disabled={busy || !name.trim()}
                onClick={doCreate}
              >
                {busy ? <span className="spin" /> : `⚔️ ${no.duel.start}`}
              </button>
              <button className="btn btn-ghost btn-block" onClick={() => setScreen("home")}>
                {no.common.back}
              </button>
            </>
          )}

          {screen === "joinName" && (
            <>
              <div className="text-center stack" style={{ gap: 4 }}>
                <div style={{ fontSize: 40 }}>⚔️</div>
                <p className="eyebrow">{no.duel.joinTitle}</p>
                <p className="faint" style={{ fontSize: 13 }}>{no.duel.joinSub}</p>
              </div>
              <div className="field">
                <label htmlFor="jn">{no.duel.yourName}</label>
                <input
                  id="jn"
                  className="input"
                  maxLength={40}
                  autoFocus
                  placeholder={no.duel.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && doJoin()}
                />
              </div>
              <button
                className="btn btn-primary btn-block btn-lg"
                disabled={busy || !name.trim()}
                onClick={doJoin}
              >
                {busy ? <span className="spin" /> : no.duel.joinCta}
              </button>
              <Link href="/" className="btn btn-ghost btn-block">
                {no.common.back}
              </Link>
            </>
          )}
        </div>

        {error && <div className="banner banner-error">{error}</div>}
      </div>
    </main>
  );
}
