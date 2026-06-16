"use client";

import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import { legalDestinations } from "@/lib/chess/validateMove";
import { needsPromotion, type PromoPiece } from "@/lib/chess/promotion";
import { PromotionPicker } from "@/lib/client/PromotionPicker";
import { Confetti } from "@/lib/client/Confetti";
import { ReplayBoard } from "@/lib/client/ReplayBoard";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { sound } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type Turn = "w" | "b";
type Outcome = "white" | "black" | "draw";

/** Same-screen pass-and-play: two humans share one device. The board rotates to
 * whoever is to move so the current player always sees their pieces at the
 * bottom. Pure client-side (chess.js) — no server, works offline. */
export function LocalVersus({ onExit }: { onExit: () => void }) {
  const chess = useRef(new Chess());
  const [fen, setFen] = useState(START);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [legal, setLegal] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [replayPgn, setReplayPgn] = useState<string | null>(null);
  // A promoting move waiting for the player to choose a piece.
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);

  const turn: Turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const refresh = () => setFen(chess.current.fen());

  function settle(): boolean {
    const c = chess.current;
    if (!c.isGameOver()) return false;
    if (c.isCheckmate()) {
      // The side to move has been mated → the OTHER side won.
      const winner: Outcome = c.turn() === "w" ? "black" : "white";
      setOutcome(winner);
      sound.play("win");
    } else {
      setOutcome("draw");
      sound.play("draw");
    }
    return true;
  }

  function tryMove(from: string, to: string, promotion?: PromoPiece): boolean {
    if (outcome) return false;
    // Needs a piece choice and none given yet → open the chooser, defer the move.
    if (!promotion && needsPromotion(chess.current.fen(), from, to)) {
      setPromo({ from, to });
      return false;
    }
    let captured = false;
    try {
      const mv = chess.current.move({ from, to, promotion: promotion ?? "q" });
      if (!mv) return false;
      captured = Boolean(mv.captured);
    } catch {
      return false;
    }
    setLastMove({ from, to });
    setSelected(null);
    setLegal([]);
    refresh();
    sound.play(chess.current.inCheck() ? "check" : captured ? "capture" : "move");
    settle();
    return true;
  }

  function newGame() {
    chess.current = new Chess();
    setFen(chess.current.fen());
    setLastMove(null);
    setSelected(null);
    setLegal([]);
    setOutcome(null);
    setReplayPgn(null);
    sound.play("start");
  }

  function undo() {
    if (chess.current.history().length === 0) return;
    chess.current.undo();
    setOutcome(null);
    setSelected(null);
    setLegal([]);
    setLastMove(null);
    refresh();
  }

  function onDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false;
    return tryMove(sourceSquare, targetSquare);
  }
  function onSquareClick({ square, piece }: SquareHandlerArgs) {
    if (outcome) return;
    if (selected && legal.includes(square)) {
      tryMove(selected, square);
      return;
    }
    if (piece) {
      setSelected(square);
      setLegal(legalDestinations(fen, square));
    } else {
      setSelected(null);
      setLegal([]);
    }
  }

  const squareStyles: Record<string, CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { background: "rgba(235,184,75,0.35)" };
    squareStyles[lastMove.to] = { background: "rgba(235,184,75,0.35)" };
  }
  if (selected) squareStyles[selected] = { background: "rgba(86,192,106,0.45)" };
  for (const sq of legal) {
    squareStyles[sq] = {
      ...(squareStyles[sq] ?? {}),
      backgroundImage:
        "radial-gradient(circle, rgba(86,192,106,0.7) 22%, transparent 24%)",
    };
  }

  const outText =
    outcome === "white"
      ? no.versus.whiteWon
      : outcome === "black"
        ? no.versus.blackWon
        : no.versus.draw;

  return (
    <main className="center-screen">
      {outcome && outcome !== "draw" && <Confetti count={120} />}
      <div className="stack" style={{ alignItems: "center", width: "100%", maxWidth: 600, gap: 16 }}>
        {!outcome && (
          <div
            className="banner banner-turn"
            style={{ width: "min(92vw,560px)" }}
            role="status"
            aria-live="polite"
          >
            {turn === "w" ? `♔ ${no.versus.whiteTurn}` : `♚ ${no.versus.blackTurn}`}
          </div>
        )}

        <div className="board-frame">
          <div className="board-shell">
            <Chessboard
              options={{
                position: fen,
                // rotate to the side to move — pass the device to that player
                boardOrientation: turn === "w" ? "white" : "black",
                allowDragging: !outcome,
                onPieceDrop: onDrop,
                onSquareClick,
                squareStyles,
                darkSquareStyle: { backgroundColor: "var(--board-dark)" },
                lightSquareStyle: { backgroundColor: "var(--board-light)" },
                animationDurationInMs: 180,
                id: "versus-board",
              }}
            />
          </div>
        </div>

        <div className="row">
          <button className="btn btn-ghost" onClick={undo}>
            ↶ {no.solo.undo}
          </button>
          <button className="btn" onClick={newGame}>
            {no.versus.newGame}
          </button>
          <button className="btn btn-ghost" onClick={onExit}>
            {no.versus.back}
          </button>
        </div>
      </div>

      {outcome && (
        <div className="result-overlay">
          {replayPgn !== null ? (
            <div className="result-card" style={{ maxWidth: 680, width: "100%" }}>
              <ReplayBoard
                pgn={replayPgn}
                orientation="white"
                whiteName={no.versus.whiteTurn.split(" ")[0]}
                blackName={no.versus.blackTurn.split(" ")[0]}
                onClose={() => setReplayPgn(null)}
              />
            </div>
          ) : (
            <div className="result-card stack" style={{ alignItems: "center", gap: 12 }}>
              <div className="result-emoji">{outcome === "draw" ? "🤝" : "🎉"}</div>
              <h1 style={{ fontSize: "clamp(34px,8vw,60px)" }}>{outText}</h1>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn btn-primary btn-lg" onClick={newGame}>
                  {no.versus.newGame}
                </button>
                <button className="btn btn-lg" onClick={onExit}>
                  {no.versus.back}
                </button>
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => setReplayPgn(chess.current.pgn())}
              >
                ♟ {no.replay.cta}
              </button>
            </div>
          )}
        </div>
      )}

      {promo && (
        <PromotionPicker
          color={turn === "w" ? "white" : "black"}
          onPick={(piece) => {
            const { from, to } = promo;
            setPromo(null);
            tryMove(from, to, piece);
          }}
          onCancel={() => setPromo(null)}
        />
      )}

      <SoundToggle />
    </main>
  );
}
