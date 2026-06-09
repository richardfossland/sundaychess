"use client";

import type { BoardState } from "@/lib/dto";
import { no } from "@/lib/locale/no";

const MEDALS = ["🥇", "🥈", "🥉"];

export function FinishedView({ state }: { state: BoardState }) {
  const top = state.standings.slice(0, 3);
  const champion = top[0];

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
            <p className="muted">
              {no.host.champion} · {champion.score} {no.host.score.toLowerCase()}
            </p>
          </>
        )}

        <div className="card stack" style={{ width: "100%", maxWidth: 460, marginTop: 16 }}>
          {top.map((s, i) => (
            <div className="spread" key={s.playerId}>
              <span style={{ fontSize: 22 }}>
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
