"use client";

import { useEffect, useState } from "react";
import type { BoardState } from "@/lib/dto";
import { QRCode } from "@/lib/client/QRCode";
import { identity } from "@/lib/client/identity";
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
    // Browser-only reads (window/localStorage) deferred to after mount.
    const base =
      process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    /* eslint-disable react-hooks/set-state-in-effect */
    setJoinUrl(`${base.replace(/\/$/, "")}/play`);
    setHostCode(identity.hostCode(tournament.id));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tournament.id]);

  async function startLeague() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/round/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId: tournament.id }),
      });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      setError(no.common.error);
      setStarting(false);
    }
  }

  const active = players.filter((p) => p.status === "active");

  return (
    <main className="wrap" style={{ padding: "32px 24px 64px" }}>
      <header className="spread" style={{ marginBottom: 28 }}>
        <span className="brandmark">
          Sunday<b>Sjakk</b>
        </span>
        {tournament.title && <span className="muted">{tournament.title}</span>}
        {hostCode && (
          <span className="badge">
            {no.host.hostCodeLabel}: <span className="mono">{hostCode}</span>
          </span>
        )}
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)",
          gap: 32,
          alignItems: "start",
        }}
      >
        {/* Join panel */}
        <section className="card stack text-center" style={{ alignItems: "center" }}>
          <p className="eyebrow">{no.host.pinLabel}</p>
          <div className="pin-hero">{tournament.joinPin}</div>
          <p className="muted">
            {no.host.joinUrlLabel} <b>{joinUrl.replace(/^https?:\/\//, "")}</b>
          </p>
          {joinUrl && <QRCode value={joinUrl} size={180} />}
          <button
            className="btn btn-primary btn-lg"
            style={{ marginTop: 8 }}
            disabled={starting || active.length < 2}
            onClick={startLeague}
          >
            {starting ? <span className="spin" /> : no.host.startLeague}
          </button>
          {active.length < 2 && (
            <p className="muted" style={{ fontSize: 13 }}>
              Minst 2 spillere må bli med.
            </p>
          )}
          {error && <div className="banner banner-error">{error}</div>}
        </section>

        {/* Roster */}
        <section className="card stack">
          <div className="spread">
            <h2 style={{ fontSize: 24 }}>{no.host.players}</h2>
            <span className="badge badge-live">{active.length}</span>
          </div>
          {active.length === 0 ? (
            <p className="muted">{no.host.noPlayers}</p>
          ) : (
            <div className="chips">
              {active.map((p) => (
                <span className="chip" key={p.id}>
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
