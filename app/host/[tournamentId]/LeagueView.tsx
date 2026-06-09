"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { OverrideModal } from "./OverrideModal";

function resultLabel(g: PublicGame, name: (id: string | null) => string): string {
  switch (g.status) {
    case "live":
      return no.host.inProgress;
    case "white_win":
      return `${name(g.whitePlayerId)} ✓`;
    case "black_win":
      return `${name(g.blackPlayerId)} ✓`;
    case "draw":
      return no.host.draw;
    case "bye":
      return no.host.bye;
    case "aborted":
      return no.host.abort;
    default:
      return "";
  }
}

export function LeagueView({
  state,
  onChanged,
}: {
  state: BoardState;
  onChanged: () => void;
}) {
  const { tournament, players, games, standings, rounds } = state;
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideGame, setOverrideGame] = useState<PublicGame | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHostCode(identity.hostCode(tournament.id));
  }, [tournament.id]);

  const nameById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.displayName]));
    return (id: string | null) => (id ? (m.get(id) ?? "?") : no.host.bye);
  }, [players]);

  const currentRound = useMemo(
    () =>
      rounds.find(
        (r) => r.number === tournament.currentRound && r.phase === "league",
      ),
    [rounds, tournament.currentRound],
  );
  const roundGames = useMemo(
    () => games.filter((g) => g.roundId === currentRound?.id),
    [games, currentRound],
  );

  const liveCount = roundGames.filter((g) => g.status === "live").length;
  const allResolved = roundGames.length > 0 && liveCount === 0;
  const isLastRound = tournament.currentRound >= tournament.config.leagueRounds;

  async function advance() {
    setBusy(true);
    setError(null);
    try {
      await api.advanceRound(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function force() {
    if (!confirm(no.host.forceResolveConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      await api.forceResolve(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap" style={{ padding: "28px 24px 64px" }}>
      <header className="spread" style={{ marginBottom: 24 }}>
        <span className="brandmark">
          <span className="knight">♞</span> Sunday<b>Sjakk</b>
        </span>
        <span className="badge badge-live">
          {no.host.round} {tournament.currentRound} / {tournament.config.leagueRounds}
        </span>
        {tournament.config.roundTimerSec && currentRound && (
          <RoundTimer
            startedAt={currentRound.startedAt}
            durationSec={tournament.config.roundTimerSec}
          />
        )}
        {tournament.title && <span className="muted">{tournament.title}</span>}
      </header>

      <div className="board-grid split-league">
        {/* Standings */}
        <section className="card">
          <h2 style={{ fontSize: 22, marginBottom: 12 }}>{no.host.standings}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{no.host.rank}</th>
                <th>{no.host.name}</th>
                <th className="num">{no.host.score}</th>
                <th className="num">{no.host.tiebreak}</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr key={s.playerId}>
                  <td>
                    <span className={`rankpill ${s.rank <= 3 ? "r" + s.rank : ""}`}>
                      {s.rank}
                    </span>
                  </td>
                  <td>{s.displayName}</td>
                  <td className="num"><b>{s.score}</b></td>
                  <td className="num muted">{s.tiebreak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Games grid */}
        <section className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 22 }}>{no.host.games}</h2>
            <span className="badge">
              {roundGames.length - liveCount} / {roundGames.length}
            </span>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            {roundGames.map((g) => (
              <button
                key={g.id}
                className="spread"
                onClick={() => g.status !== "bye" && setOverrideGame(g)}
                style={{
                  textAlign: "left",
                  background: "var(--ink-soft)",
                  border: "1px solid var(--ink-line)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  cursor: g.status === "bye" ? "default" : "pointer",
                  color: "inherit",
                  font: "inherit",
                }}
              >
                <span>
                  <b>{nameById(g.whitePlayerId)}</b>
                  {g.blackPlayerId ? (
                    <>
                      {" "}
                      <span className="muted">{no.player.vs}</span>{" "}
                      <b>{nameById(g.blackPlayerId)}</b>
                    </>
                  ) : null}
                </span>
                <span
                  className={`badge ${g.status === "live" ? "badge-live" : "badge-done"}`}
                >
                  {resultLabel(g, nameById)}
                </span>
              </button>
            ))}
          </div>

          <div className="row" style={{ marginTop: 18 }}>
            <button
              className="btn btn-primary grow"
              disabled={busy || !allResolved}
              onClick={advance}
            >
              {busy ? <span className="spin" /> : isLastRound ? "Fullfør" : no.host.nextRound}
            </button>
            {liveCount > 0 && (
              <button className="btn btn-danger" disabled={busy} onClick={force}>
                {no.host.forceResolve}
              </button>
            )}
          </div>
          {!allResolved && (
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Alle partier må være ferdige før neste runde.
            </p>
          )}
          {error && <div className="banner banner-error" style={{ marginTop: 10 }}>{error}</div>}
        </section>
      </div>

      {overrideGame && (
        <OverrideModal
          gameId={overrideGame.id}
          hostCode={hostCode ?? ""}
          title={`${nameById(overrideGame.whitePlayerId)} ${no.player.vs} ${nameById(overrideGame.blackPlayerId)}`}
          onClose={() => setOverrideGame(null)}
          onDone={() => {
            setOverrideGame(null);
            onChanged();
          }}
        />
      )}
    </main>
  );
}
