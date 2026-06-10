"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { BoardState } from "@/lib/dto";
import { QRCode } from "@/lib/client/QRCode";
import { identity } from "@/lib/client/identity";
import { api } from "@/lib/client/api";
import { initials } from "@/lib/client/Confetti";
import { no } from "@/lib/locale/no";

export function LobbyView({
  state,
  onChanged,
}: {
  state: BoardState;
  onChanged: () => void;
}) {
  const { tournament, players } = state;
  const [joinUrl, setJoinUrl] = useState("");
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    /* eslint-disable react-hooks/set-state-in-effect */
    setJoinUrl(`${base.replace(/\/$/, "")}/play`);
    setHostCode(identity.hostCode(tournament.id));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tournament.id]);

  async function startLeague() {
    setStarting(true);
    setError(null);
    try {
      await api.startRound(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
      setStarting(false);
    }
  }

  const active = players.filter((p) => p.status === "active");

  return (
    <main className="wrap" style={{ padding: "34px 24px 64px" }}>
      <header className="spread reveal" style={{ marginBottom: 30 }}>
        <span className="brandmark">
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </span>
        <div className="row" style={{ gap: 12 }}>
          {tournament.title && <span className="muted">{tournament.title}</span>}
          {hostCode && (
            <span className="badge">
              Vertskode <span className="mono" style={{ color: "var(--gold)" }}>{hostCode}</span>
            </span>
          )}
        </div>
      </header>

      <div className="board-grid split-lobby">
        {/* Join panel */}
        <section
          className="card stack text-center reveal"
          style={{ alignItems: "center", padding: "40px 32px", ["--i" as string]: 1 } as CSSProperties}
        >
          <p className="eyebrow">{no.host.pinLabel}</p>
          <div className="pin-hero">{tournament.joinPin}</div>
          <div className="row" style={{ gap: 8, color: "var(--txt-dim)", fontSize: 15 }}>
            <span>Gå til</span>
            <b style={{ color: "var(--txt)" }}>{joinUrl.replace(/^https?:\/\//, "")}</b>
          </div>
          {joinUrl && (
            <div
              className="scale-in"
              style={{ padding: 12, background: "var(--paper)", borderRadius: 16, boxShadow: "var(--shadow-2)" }}
            >
              <QRCode value={joinUrl} size={172} />
            </div>
          )}
          <button
            className="btn btn-primary btn-lg"
            style={{ marginTop: 6, minWidth: 220 }}
            disabled={starting || active.length < 2}
            onClick={startLeague}
          >
            {starting ? <span className="spin" /> : `${no.host.startLeague} →`}
          </button>
          {active.length < 2 && (
            <p className="faint" style={{ fontSize: 13 }}>Minst 2 spillere må bli med.</p>
          )}
          {error && <div className="banner banner-error">{error}</div>}
        </section>

        {/* Roster */}
        <section className="card stack reveal" style={{ ["--i" as string]: 2 } as CSSProperties}>
          <div className="spread">
            <h2 style={{ fontSize: 26 }}>{no.host.players}</h2>
            <span className="badge badge-live">{active.length}</span>
          </div>
          <hr className="thread" />
          {active.length === 0 ? (
            <p className="muted" style={{ padding: "28px 0", textAlign: "center" }}>
              {no.host.noPlayers}
            </p>
          ) : (
            <div className="chips">
              {active.map((p) => (
                <span className="chip" key={p.id}>
                  <span className="avatar">{initials(p.displayName)}</span>
                  {p.displayName}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
