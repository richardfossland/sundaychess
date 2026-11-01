"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import { legalDestinations } from "@/lib/chess/validateMove";
import { needsPromotion, type PromoPiece } from "@/lib/chess/promotion";
import { PromotionPicker } from "@/lib/client/PromotionPicker";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { Confetti } from "@/lib/client/Confetti";
import { ReplayBoard } from "@/lib/client/ReplayBoard";
import { BOARD_BASE_OPTIONS, highlightStyles } from "@/lib/client/boardOptions";
import { GameLayout } from "@/lib/client/GameLayout";
import { MoveList } from "@/lib/client/MoveList";
import { PlayerBar } from "@/lib/client/PlayerBar";
import { useReducedMotion } from "@/lib/client/useReducedMotion";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { sound } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";

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
  // Mirrors chess.current.history().length — kept as state (not read from the
  // ref during render) so "Angre"/"Nytt parti" can safely gate on it in JSX.
  // Synced everywhere `refresh()` is (see there).
  const [historyLen, setHistoryLen] = useState(0);
  const [sans, setSans] = useState<string[]>([]); // for the move list (state, not a ref read in render)
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [legal, setLegal] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [replayPgn, setReplayPgn] = useState<string | null>(null);
  // A promoting move waiting for the player to choose a piece.
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const reducedMotion = useReducedMotion();
  // "Nytt parti" mid-game asks first — only when there's an actual game in
  // progress to lose (newGame() below resets the board with no way back).
  const [confirmNewGame, setConfirmNewGame] = useState(false);

  const turn: Turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const refresh = () => {
    setFen(chess.current.fen());
    const h = chess.current.history();
    setHistoryLen(h.length);
    setSans(h);
  };

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
    refresh();
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

  const squareStyles = highlightStyles({ last: lastMove, selected, legal });

  const outText =
    outcome === "white"
      ? no.versus.whiteWon
      : outcome === "black"
        ? no.versus.blackWon
        : no.versus.draw;

  // The board rotates to the side to move, so "bottom" is always the player to
  // move and "top" the one waiting.
  const mover: "white" | "black" = turn === "w" ? "white" : "black";
  const waiter: "white" | "black" = turn === "w" ? "black" : "white";
  const name = (c: "white" | "black") => (c === "white" ? no.versus.whiteName : no.versus.blackName);

  return (
    <GameLayout
      status={
        !outcome ? (
          <div className="banner banner-turn" role="status" aria-live="polite">
            {turn === "w" ? `♔ ${no.versus.whiteTurn}` : `♚ ${no.versus.blackTurn}`}
          </div>
        ) : undefined
      }
      top={
        <PlayerBar
          name={name(waiter)}
          color={waiter}
          colorLabel=""
          avatar={waiter === "white" ? "♔" : "♚"}
          fen={fen}
          active={false}
        />
      }
      bottom={
        <PlayerBar
          name={name(mover)}
          color={mover}
          colorLabel=""
          avatar={mover === "white" ? "♔" : "♚"}
          me
          fen={fen}
          active={!outcome}
        />
      }
      board={
        <Chessboard
          options={{
            ...BOARD_BASE_OPTIONS,
            position: fen,
            // rotate to the side to move — pass the device to that player
            boardOrientation: mover,
            allowDragging: !outcome,
            showAnimations: !reducedMotion,
            onPieceDrop: onDrop,
            onSquareClick,
            squareStyles,
            id: "versus-board",
          }}
        />
      }
      moves={<MoveList sans={sans} />}
      actions={
        <>
          <button
            className="btn btn-ghost"
            onClick={undo}
            disabled={historyLen === 0}
          >
            <Icon name="undo" size={16} /> {no.solo.undo}
          </button>
          <button
            className="btn"
            onClick={() => (historyLen > 0 ? setConfirmNewGame(true) : newGame())}
          >
            {no.versus.newGame}
          </button>
          <button className="btn btn-ghost" onClick={onExit}>
            {no.versus.back}
          </button>
        </>
      }
      tools={<SoundToggle />}
    >
      {outcome && outcome !== "draw" && <Confetti count={120} />}

      {outcome && (
        <div className="result-overlay">
          {replayPgn !== null ? (
            <div className="result-card result-card-wide">
              <ReplayBoard
                pgn={replayPgn}
                orientation="white"
                whiteName={no.versus.whiteTurn.split(" ")[0]}
                blackName={no.versus.blackTurn.split(" ")[0]}
                onClose={() => setReplayPgn(null)}
              />
            </div>
          ) : (
            <div className="result-card stack result-stack">
              <div className="result-emoji"><Icon name={outcome === "draw" ? "draw" : "party"} size={84} strokeWidth={1.4} /></div>
              <h1 className="result-title">{outText}</h1>
              <div className="row mt-2">
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

      {confirmNewGame && (
        <ConfirmDialog
          message={no.versus.newGameConfirm}
          confirmLabel={no.versus.newGame}
          onConfirm={() => {
            setConfirmNewGame(false);
            newGame();
          }}
          onCancel={() => setConfirmNewGame(false)}
        />
      )}

    </GameLayout>
  );
}
