"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { BoardState } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import { ChessClock } from "@/lib/client/ChessClock";
import { no } from "@/lib/locale/no";
import { variantStartFen } from "@/lib/chess/variants";
import { plyOf } from "@/lib/chess/ply";
import { SpectateGame } from "./SpectateGame";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

/** Client clock snapshot, stamped with local receipt time so ChessClock can
 * tick the running side down. */
type ClockSnap = {
  whiteMs: number;
  blackMs: number;
  turn: Turn;
  running: boolean;
  at: number;
};

/** One side's clock for a spectated game (static unless it's that side's turn). */
function SideClock({ clk, side }: { clk: ClockSnap | undefined; side: Turn }) {
  if (!clk) return null;
  const ms = side === "w" ? clk.whiteMs : clk.blackMs;
  return <ChessClock ms={ms} at={clk.at} running={clk.running && clk.turn === side} />;
}

/** Column min-width for the responsive grid: fewer live games ⇒ bigger boards
 * so the projector stays readable as a round winds down. (1 game is special-
 * cased to a single large board.) */
function gridMin(liveCount: number): number {
  if (liveCount <= 3) return 440;
  if (liveCount <= 6) return 320;
  return 220;
}

export function LiveGamesView({
  state,
  onStale,
}: {
  state: BoardState;
  onStale?: () => void;
}) {
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
  // Live clock per game (timed tournaments). Seeded from the board poll, patched
  // by the spectate feed on every move.
  const [clockMap, setClockMap] = useState<Record<string, ClockSnap>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  // Games we've seen finish this session — drop them from the grid the instant
  // the result event arrives, without waiting for the next board poll.
  const [finished, setFinished] = useState<Set<string>>(() => new Set());
  // Result of the currently-open game (drives the winner animation + auto-close).
  const [openResult, setOpenResult] = useState<GameStatus | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFenMap((m) => {
      const next = { ...m };
      for (const g of games) {
        if (!next[g.id] || plyOf(g.fen) >= plyOf(next[g.id])) next[g.id] = g.fen;
      }
      const liveIds = new Set(games.filter((g) => g.status === "live").map((g) => g.id));
      for (const id of Object.keys(next)) {
        if (!liveIds.has(id)) delete next[id];
      }
      return next;
    });
    setClockMap((m) => {
      const next: Record<string, ClockSnap> = {};
      const at = Date.now();
      for (const g of games) {
        if (g.status !== "live" || !g.clock) continue;
        // keep a fresher channel snapshot if we already have one this tick
        next[g.id] = m[g.id] ?? { ...g.clock, at };
      }
      return next;
    });
  }, [games]);

  useChannel(
    channels.spectate(tournament.id),
    (event, payload) => {
      if (event === "position") {
        const p = payload as {
          gameId: string;
          fen: string;
          clock?: ClockSnap | null;
        };
        setFenMap((m) =>
          !m[p.gameId] || plyOf(p.fen) >= plyOf(m[p.gameId])
            ? { ...m, [p.gameId]: p.fen }
            : m,
        );
        if (p.clock) {
          const at = Date.now();
          setClockMap((m) => ({ ...m, [p.gameId]: { ...p.clock!, at } }));
        }
      } else if (event === "result") {
        const p = payload as { gameId: string; status: GameStatus };
        // Drop it from the grid immediately; refetch authoritative standings.
        setFinished((s) => (s.has(p.gameId) ? s : new Set(s).add(p.gameId)));
        if (p.gameId === openId) setOpenResult(p.status);
        onStale?.();
      }
    },
    (s) => {
      // Spectate broadcasts silently stopped → refetch the board so the live
      // grid recovers instead of freezing on stale positions.
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") onStale?.();
    },
  );

  // Auto-return from a finished spectated game after the winner animation.
  useEffect(() => {
    if (!openResult) return;
    const t = setTimeout(() => {
      setOpenId(null);
      setOpenResult(null);
    }, 4500);
    return () => clearTimeout(t);
  }, [openResult]);

  const live = games.filter(
    (g) => g.status === "live" && g.blackPlayerId && !finished.has(g.id),
  );

  if (openId) {
    const g = games.find((x) => x.id === openId);
    if (g) {
      return (
        <SpectateGame
          gameId={g.id}
          fen={fenMap[g.id] ?? g.fen}
          baselineFen={variantStartFen(tournament.config.variant)}
          white={nameById(g.whitePlayerId)}
          black={nameById(g.blackPlayerId)}
          clock={clockMap[g.id]}
          result={openResult}
          onClose={() => {
            setOpenId(null);
            setOpenResult(null);
          }}
        />
      );
    }
  }

  // The header card markup for one game (names + clocks).
  const Heads = (g: (typeof live)[number]) => (
    <div className="spread" style={{ marginBottom: 8, fontSize: 14, alignItems: "center" }}>
      <span className="row" style={{ gap: 6 }}>
        <b>{nameById(g.whitePlayerId)}</b>
        <SideClock clk={clockMap[g.id]} side="w" />
      </span>
      <span className="faint">vs</span>
      <span className="row" style={{ gap: 6 }}>
        <SideClock clk={clockMap[g.id]} side="b" />
        <b>{nameById(g.blackPlayerId)}</b>
      </span>
    </div>
  );

  // 1 game left → one big board that fills the projector.
  if (live.length === 1) {
    const g = live[0];
    return (
      <main className="wrap" style={{ padding: "12px 24px 48px", maxWidth: "min(96vw, 1100px)" }}>
        <button
          onClick={() => setOpenId(g.id)}
          className="card reveal"
          style={{ padding: 16, cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
        >
          {Heads(g)}
          <div className="stack" style={{ alignItems: "center" }}>
            <div className="board-shell-lg" style={{ borderRadius: 8, overflow: "hidden" }}>
              <Chessboard
                options={{
                  position: fenMap[g.id] ?? g.fen,
                  allowDragging: false,
                  showNotation: true,
                  darkSquareStyle: { backgroundColor: "var(--board-dark)" },
                  lightSquareStyle: { backgroundColor: "var(--board-light)" },
                  id: `big-${g.id}`,
                }}
              />
            </div>
          </div>
        </button>
      </main>
    );
  }

  return (
    <main className="wrap" style={{ padding: "12px 24px 64px", maxWidth: "min(96vw, 1800px)" }}>
      {live.length === 0 ? (
        <p className="muted text-center" style={{ padding: 40 }}>
          Ingen partier pågår akkurat nå.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin(live.length)}px, 1fr))`,
            gap: 20,
            justifyContent: "center",
          }}
        >
          {live.map((g) => (
            <button
              key={g.id}
              onClick={() => setOpenId(g.id)}
              className="card reveal"
              style={{ padding: 12, cursor: "pointer", textAlign: "left", color: "inherit" }}
            >
              {Heads(g)}
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
