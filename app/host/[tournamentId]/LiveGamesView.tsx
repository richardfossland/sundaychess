"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { BoardState } from "@/lib/dto";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import { no } from "@/lib/locale/no";
import { SpectateGame } from "./SpectateGame";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

/** Approx half-move count from a FEN — lets us merge poll vs realtime updates
 * without ever regressing to an older position. */
function plyOf(fen: string): number {
  const parts = fen.split(" ");
  const full = parseInt(parts[5] ?? "1", 10) || 1;
  return (full - 1) * 2 + (parts[1] === "b" ? 1 : 0);
}

export function LiveGamesView({ state }: { state: BoardState }) {
  const { tournament, players, games } = state;
  const nameById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.displayName]));
    return (id: string | null) => (id ? (m.get(id) ?? "?") : no.host.bye);
  }, [players]);

  // Freshest FEN per game: realtime spectate patches instantly, the 5 s board
  // poll self-heals; merge by ply so we never show an older position.
  const [fenMap, setFenMap] = useState<Record<string, string>>(() =>
    Object.fromEntries(games.map((g) => [g.id, g.fen])),
  );
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFenMap((m) => {
      const next = { ...m };
      for (const g of games) {
        if (!next[g.id] || plyOf(g.fen) >= plyOf(next[g.id])) next[g.id] = g.fen;
      }
      return next;
    });
  }, [games]);

  useChannel(channels.spectate(tournament.id), (event, payload) => {
    if (event !== "position") return;
    const p = payload as { gameId: string; fen: string };
    setFenMap((m) =>
      !m[p.gameId] || plyOf(p.fen) >= plyOf(m[p.gameId])
        ? { ...m, [p.gameId]: p.fen }
        : m,
    );
  });

  const live = games.filter((g) => g.status === "live" && g.blackPlayerId);

  if (openId) {
    const g = games.find((x) => x.id === openId);
    if (g) {
      return (
        <SpectateGame
          fen={fenMap[g.id] ?? g.fen}
          white={nameById(g.whitePlayerId)}
          black={nameById(g.blackPlayerId)}
          onClose={() => setOpenId(null)}
        />
      );
    }
  }

  return (
    <main className="wrap" style={{ padding: "12px 24px 64px" }}>
      {live.length === 0 ? (
        <p className="muted text-center" style={{ padding: 40 }}>
          Ingen partier pågår akkurat nå.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: 20,
          }}
        >
          {live.map((g) => (
            <button
              key={g.id}
              onClick={() => setOpenId(g.id)}
              className="card reveal"
              style={{ padding: 12, cursor: "pointer", textAlign: "left", color: "inherit" }}
            >
              <div className="spread" style={{ marginBottom: 8, fontSize: 13 }}>
                <b>{nameById(g.whitePlayerId)}</b>
                <span className="faint">vs</span>
                <b>{nameById(g.blackPlayerId)}</b>
              </div>
              <div style={{ borderRadius: 8, overflow: "hidden" }}>
                <Chessboard
                  options={{
                    position: fenMap[g.id] ?? g.fen,
                    allowDragging: false,
                    showNotation: false,
                    darkSquareStyle: { backgroundColor: "var(--board-dark)" },
                    lightSquareStyle: { backgroundColor: "var(--board-light)" },
                    id: `mini-${g.id}`,
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
