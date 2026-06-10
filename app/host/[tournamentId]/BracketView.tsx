"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { api, ApiError } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { OverrideModal } from "./OverrideModal";

function winnerId(g: PublicGame): string | null {
  if (g.status === "white_win") return g.whitePlayerId;
  if (g.status === "black_win") return g.blackPlayerId;
  return null;
}

export function BracketView({
  state,
  onChanged,
}: {
  state: BoardState;
  onChanged: () => void;
}) {
  const { tournament, players, games, rounds } = state;
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideGame, setOverrideGame] = useState<PublicGame | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHostCode(identity.hostCode(tournament.id));
  }, [tournament.id]);

  const player = useMemo(() => {
    const byId = new Map(players.map((p) => [p.id, p]));
    return (id: string | null) => (id ? byId.get(id) : null);
  }, [players]);

  const columns = useMemo(() => {
    const pr = rounds
      .filter((r) => r.phase === "playoff")
      .sort((a, b) => a.number - b.number);
    return pr.map((r) => ({
      round: r,
      games: games.filter((g) => g.roundId === r.id),
    }));
  }, [rounds, games]);

  const currentCol = columns.find(
    (c) => c.round.number === tournament.currentRound,
  );
  const liveCount = currentCol?.games.filter((g) => g.status === "live").length ?? 0;
  const allResolved =
    (currentCol?.games.length ?? 0) > 0 && liveCount === 0;
  const isFinal = (currentCol?.games.length ?? 0) === 1;

  async function advance() {
    setBusy(true);
    setError(null);
    try {
      await api.advanceRound(tournament.id, hostCode ?? "");
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === "needs_decision") {
        setError("Avgjør uavgjorte partier først — overstyr dem til en vinner.");
      } else setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  const slot = (g: PublicGame, side: "white" | "black") => {
    const id = side === "white" ? g.whitePlayerId : g.blackPlayerId;
    const p = player(id);
    const won = winnerId(g) === id && id !== null;
    return (
      <div className={`bracket-slot ${won ? "win" : ""} ${p ? "" : "tbd"}`}>
        <span>
          {p?.seed != null && <span className="seed">{p.seed}</span>} {p?.displayName ?? "—"}
        </span>
        {won && <span>✓</span>}
      </div>
    );
  };

  return (
    <main className="wrap" style={{ padding: "28px 24px 64px" }}>
      <header className="spread" style={{ marginBottom: 24 }}>
        <span className="brandmark">
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </span>
        <span className="badge badge-live">{no.host.bracket}</span>
        {tournament.title && <span className="muted">{tournament.title}</span>}
      </header>

      <div className="bracket">
        {columns.map((col) => (
          <div className="bracket-col" key={col.round.id}>
            <h3>
              {col.games.length === 1
                ? "Finale"
                : `${no.host.round} ${col.round.number}`}
            </h3>
            {col.games.map((g) => (
              <div
                className="bracket-match"
                key={g.id}
                onClick={() => g.status !== "bye" && setOverrideGame(g)}
              >
                {slot(g, "white")}
                {slot(g, "black")}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 24, maxWidth: 480 }}>
        <button
          className="btn btn-primary grow"
          disabled={busy || !allResolved}
          onClick={advance}
        >
          {busy ? <span className="spin" /> : isFinal ? "Kår mester" : no.host.nextRound}
        </button>
      </div>
      {!allResolved && (
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Alle partier i runden må være ferdige.
        </p>
      )}
      {error && <div className="banner banner-error" style={{ marginTop: 10, maxWidth: 480 }}>{error}</div>}

      {overrideGame && (
        <OverrideModal
          gameId={overrideGame.id}
          hostCode={hostCode ?? ""}
          title={`${player(overrideGame.whitePlayerId)?.displayName ?? "?"} ${no.player.vs} ${player(overrideGame.blackPlayerId)?.displayName ?? "?"}`}
          onClose={() => setOverrideGame(null)}
          allowAbort={false}
          onDone={() => {
            setOverrideGame(null);
            onChanged();
          }}
        />
      )}
    </main>
  );
}
