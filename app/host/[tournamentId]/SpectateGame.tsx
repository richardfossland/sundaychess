"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EvalBar } from "@/lib/client/EvalBar";
import { CapturedPieces } from "@/lib/client/CapturedPieces";
import { ChessClock } from "@/lib/client/ChessClock";
import { HypeCallout } from "@/lib/client/HypeCallout";
import { ReactionLayer, type FloatingReaction } from "@/lib/client/Reactions";
import { MoveList, sansFromPgn } from "@/lib/client/MoveList";
import { PlayBoard } from "@/lib/client/PlayBoard";
import { lastMoveStylesKey } from "@/lib/chess/lastMove";
import { api } from "@/lib/client/api";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { Confetti, initials } from "@/lib/client/Confetti";
import { sound } from "@/lib/client/sound";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import type { GameStatus, Turn } from "@/lib/types";
import { no } from "@/lib/locale/no";

// L8: the board is read-only here — PlayBoard's onDrop/onSquareClick identity
// is ignored by its own memo (lib/client/PlayBoard.tsx), so these could be
// fresh closures every render, but module-level constants cost nothing and
// make the "this never does anything" intent explicit at the call site.
const NOOP_DROP = () => false;
const NOOP_CLICK = () => {};

type ClockSnap = {
  whiteMs: number;
  blackMs: number;
  turn: Turn;
  running: boolean;
  at: number;
};

function SpectatePlayer({
  name,
  side,
  fen,
  baselineFen,
  clock,
}: {
  name: string;
  side: "white" | "black";
  fen: string;
  baselineFen?: string;
  clock?: ClockSnap;
}) {
  const turn: Turn = side === "white" ? "w" : "b";
  return (
    <div className="spread" style={{ width: "min(92vw, 520px)" }}>
      <div className="row" style={{ gap: 10 }}>
        <span
          className="avatar-lg"
          style={
            side === "black"
              ? {
                  background: "linear-gradient(180deg,var(--ink-soft),#1c212b)",
                  color: "var(--txt)",
                  border: "1px solid var(--ink-line-strong)",
                }
              : undefined
          }
        >
          {initials(name)}
        </span>
        <b style={{ fontSize: 18 }}>{name}</b>
        {clock && (
          <ChessClock
            ms={turn === "w" ? clock.whiteMs : clock.blackMs}
            at={clock.at}
            running={clock.running && clock.turn === turn}
          />
        )}
      </div>
      <CapturedPieces fen={fen} side={side} baselineFen={baselineFen} />
    </div>
  );
}

/** Big-screen spectator view of one game: large read-only board with the
 * engine eval bar, hype callouts, captured pieces, player reactions and a
 * subtle move tick. Position is driven by `fen` from the parent (which patches
 * it live); when `result` is set the game just ended → a winner animation. */
export function SpectateGame({
  gameId,
  fen,
  white,
  black,
  onClose,
  baselineFen,
  clock,
  result,
}: {
  gameId: string;
  fen: string;
  white: string;
  black: string;
  onClose: () => void;
  baselineFen?: string;
  clock?: ClockSnap;
  result?: GameStatus | null;
}) {
  const [floats, setFloats] = useState<FloatingReaction[]>([]);
  const floatSeq = useRef(0);

  // SpectateGame is FEN-driven (the parent patches `fen` live from broadcasts),
  // so there's no PGN here — fetch it for the move list when the position changes
  // (one cheap fetch per move, for the single game being spectated). The same
  // fetch's `lastMove` (L8) drives the board's last-move highlight below.
  const [sans, setSans] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    api
      .game(gameId)
      .then((d) => {
        if (!live) return;
        setSans(sansFromPgn(d.pgn));
        setLastMove(d.lastMove ? { from: d.lastMove.from, to: d.lastMove.to } : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [gameId, fen]);

  // L8: routed through <PlayBoard> (same insulation GameView gets from L5) —
  // squareStyles and stylesKey are derived from the SAME {from,to} pair in the
  // same render, so they can't drift apart (lib/client/PlayBoard.tsx).
  const lastFrom = lastMove?.from ?? null;
  const lastTo = lastMove?.to ?? null;
  const stylesKey = lastMoveStylesKey(lastMove);
  const squareStyles = useMemo(() => {
    if (!lastFrom || !lastTo) return {};
    const hl = { background: "rgba(235,184,75,0.35)" };
    return { [lastFrom]: { ...hl }, [lastTo]: { ...hl } };
  }, [lastFrom, lastTo]);

  const addFloat = useCallback((emoji: string) => {
    const id = ++floatSeq.current;
    setFloats((f) => [...f, { id, emoji, x: 12 + Math.random() * 70 }]);
    setTimeout(() => setFloats((f) => f.filter((r) => r.id !== id)), 2600);
  }, []);

  useChannel(channels.game(gameId), (event, payload) => {
    if (event !== "reaction") return;
    const p = payload as { emoji?: string };
    if (typeof p.emoji === "string" && p.emoji.length <= 8) addFloat(p.emoji);
  });

  // subtle tick on each new position (skip the first render)
  const prevFen = useRef<string | null>(null);
  useEffect(() => {
    if (prevFen.current !== null && prevFen.current !== fen) sound.play("tick");
    prevFen.current = fen;
  }, [fen]);

  const decided = result && result !== "live";
  // celebration sound, once, when the result lands
  const cheered = useRef(false);
  useEffect(() => {
    if (decided && !cheered.current) {
      cheered.current = true;
      sound.play(result === "draw" ? "draw" : "win");
    }
  }, [decided, result]);

  const winnerText =
    result === "white_win"
      ? `${white} ${no.host.spectateWon}`
      : result === "black_win"
        ? `${black} ${no.host.spectateWon}`
        : result === "draw"
          ? no.host.spectateDraw
          : "";

  return (
    <main className="center-screen is-game">
      {(result === "white_win" || result === "black_win") && <Confetti count={140} />}
      <div className="stack" style={{ alignItems: "center", gap: 14 }}>
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onClose}>
          ← {no.host.liveToggle}
        </button>

        <SpectatePlayer name={black} side="black" fen={fen} baselineFen={baselineFen} clock={clock} />

        <div className="row" style={{ gap: 12, alignItems: "stretch" }}>
          <EvalBar fen={fen} />
          <div className="board-frame">
            <div className="board-shell-lg">
              <PlayBoard
                id="spectate-board"
                fen={fen}
                orientation="white"
                allowDragging={false}
                showNotation
                squareStyles={squareStyles}
                stylesKey={stylesKey}
                onDrop={NOOP_DROP}
                onSquareClick={NOOP_CLICK}
              />
            </div>
            <HypeCallout fen={fen} />
            <ReactionLayer items={floats} />
            {decided && (
              <div className="result-overlay" style={{ position: "absolute", borderRadius: 8 }}>
                <div className="result-card stack" style={{ alignItems: "center", gap: 8 }}>
                  <div className="result-emoji">{result === "draw" ? "🤝" : "🏆"}</div>
                  <h2 style={{ fontSize: "clamp(28px,5vw,48px)", textAlign: "center" }}>
                    {winnerText}
                  </h2>
                </div>
              </div>
            )}
          </div>
        </div>

        <SpectatePlayer name={white} side="white" fen={fen} baselineFen={baselineFen} clock={clock} />

        {/* L8: always mounted, like the player screen after L2 — MoveList
            already renders a "–" placeholder for an empty list, and .movelist
            has a fixed height, so the projector layout doesn't shift (board
            box, scrollY) the moment the first move lands. */}
        <MoveList sans={sans} />
      </div>

      <SoundToggle />
      <FullscreenToggle />
    </main>
  );
}
