"use client";

import { useMemo } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { no } from "@/lib/locale/no";

const MEDALS = ["🥇", "🥈", "🥉"];

function gameWinner(g: PublicGame): string | null {
  if (g.status === "white_win") return g.whitePlayerId;
  if (g.status === "black_win") return g.blackPlayerId;
  return null;
}

export function FinishedView({ state }: { state: BoardState }) {
  const { standings, players, games, rounds } = state;

  // The champion is the winner of the final playoff game when there was a
  // playoff; otherwise the league leader.
  const champion = useMemo(() => {
    const playoffRounds = rounds
      .filter((r) => r.phase === "playoff")
      .sort((a, b) => b.number - a.number);
    if (playoffRounds.length > 0) {
      const finalRound = playoffRounds[0];
      const finalGame = games.find((g) => g.roundId === finalRound.id);
      const winnerId = finalGame ? gameWinner(finalGame) : null;
      const p = winnerId ? players.find((pl) => pl.id === winnerId) : null;
      if (p) return { displayName: p.displayName, score: p.score };
    }
    return standings[0]
      ? { displayName: standings[0].displayName, score: standings[0].score }
      : null;
  }, [rounds, games, players, standings]);

  const top = standings.slice(0, 3);

  return (
    <main className="center-screen">
      <div className="stack text-center" style={{ alignItems: "center", maxWidth: 640 }}>
        <span className="brandmark">
          Sunday<b>Sjakk</b>
        </span>
        <p className="eyebrow">{no.host.podium}</p>
        {champion && (
          <>
            <div style={{ fontSize: 72 }}>🏆</div>
            <h1 style={{ fontSize: "clamp(36px,8vw,72px)" }}>{champion.displayName}</h1>
            <p className="muted">{no.host.champion}</p>
          </>
        )}

        <div className="card stack" style={{ width: "100%", maxWidth: 460, marginTop: 16 }}>
          <p className="eyebrow" style={{ textAlign: "left" }}>
            {no.host.standings}
          </p>
          {top.map((s, i) => (
            <div className="spread" key={s.playerId}>
              <span style={{ fontSize: 20 }}>
                {MEDALS[i]} <b>{s.displayName}</b>
              </span>
              <span className="badge">{s.score}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
