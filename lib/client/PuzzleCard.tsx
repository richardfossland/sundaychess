"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import { PUZZLES, puzzleTurn } from "@/lib/puzzles";
import { legalDestinations } from "@/lib/chess/validateMove";
import { sound } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

const SOLVED_KEY = "sundaychess:puzzles-solved";

function readSolved(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(SOLVED_KEY) ?? "0", 10) || 0;
}

/** Mate-in-1 trainer for players who are waiting (bye / between rounds).
 * Everything is client-side: chess.js validates, "did it checkmate?" decides. */
export function PuzzleCard() {
  const [puzzleIdx, setPuzzleIdx] = useState(() =>
    Math.floor(Math.random() * PUZZLES.length),
  );
  const puzzle = PUZZLES[puzzleIdx];
  const [solved, setSolved] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [solvedCount, setSolvedCount] = useState(readSolved);
  const [selected, setSelected] = useState<string | null>(null);
  const [legal, setLegal] = useState<string[]>([]);
  // shown position: the puzzle FEN, or the mate position once solved
  const [fen, setFen] = useState(puzzle.fen);

  const turn = puzzleTurn(puzzle);
  const orientation = turn === "w" ? "white" : "black";

  const next = useCallback(() => {
    const n = (puzzleIdx + 1 + Math.floor(Math.random() * (PUZZLES.length - 1))) % PUZZLES.length;
    setPuzzleIdx(n);
    setFen(PUZZLES[n].fen);
    setSolved(false);
    setWrong(false);
    setSelected(null);
    setLegal([]);
  }, [puzzleIdx]);

  const tryMove = useCallback(
    (from: string, to: string): boolean => {
      if (solved) return false;
      const chess = new Chess(puzzle.fen);
      try {
        chess.move({ from, to, promotion: "q" });
      } catch {
        return false; // illegal — let the piece snap back silently
      }
      setSelected(null);
      setLegal([]);
      if (chess.isCheckmate()) {
        setFen(chess.fen());
        setSolved(true);
        setWrong(false);
        sound.play("win");
        const n = readSolved() + 1;
        try {
          localStorage.setItem(SOLVED_KEY, String(n));
        } catch {
          // private mode — counter stays in-memory
        }
        setSolvedCount(n);
      } else {
        // legal but not mate → reset and nudge
        setWrong(true);
        setFen(puzzle.fen);
        sound.play("move");
        setTimeout(() => setWrong(false), 1800);
      }
      return true;
    },
    [puzzle, solved],
  );

  function onDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false;
    return tryMove(sourceSquare, targetSquare);
  }

  function onSquareClick({ square, piece }: SquareHandlerArgs) {
    if (solved) return;
    if (selected && legal.includes(square)) {
      tryMove(selected, square);
      return;
    }
    if (piece) {
      setSelected(square);
      setLegal(legalDestinations(puzzle.fen, square));
    } else {
      setSelected(null);
      setLegal([]);
    }
  }

  const squareStyles = useMemo(() => {
    const s: Record<string, React.CSSProperties> = {};
    if (selected) s[selected] = { background: "rgba(86,192,106,0.45)" };
    for (const sq of legal) {
      s[sq] = {
        ...(s[sq] ?? {}),
        backgroundImage:
          "radial-gradient(circle, rgba(86,192,106,0.7) 22%, transparent 24%)",
      };
    }
    return s;
  }, [selected, legal]);

  return (
    <div className="card stack" style={{ padding: 18, width: "100%", maxWidth: 420, alignItems: "center", gap: 10 }}>
      <div className="spread" style={{ width: "100%" }}>
        <p className="eyebrow" style={{ fontSize: 11 }}>🧩 {no.puzzle.title}</p>
        {solvedCount > 0 && (
          <span className="badge">
            {solvedCount} {no.puzzle.counter}
          </span>
        )}
      </div>
      <p style={{ fontSize: 14 }}>
        <b>{no.puzzle.prompt}</b>{" "}
        <span className="muted">
          — {turn === "w" ? no.puzzle.toMoveWhite : no.puzzle.toMoveBlack}
        </span>
      </p>

      <div style={{ width: "100%", borderRadius: 8, overflow: "hidden" }}>
        <Chessboard
          options={{
            position: fen,
            boardOrientation: orientation,
            allowDragging: !solved,
            onPieceDrop: onDrop,
            onSquareClick,
            squareStyles,
            darkSquareStyle: { backgroundColor: "var(--board-dark)" },
            lightSquareStyle: { backgroundColor: "var(--board-light)" },
            animationDurationInMs: 150,
            id: `puzzle-${puzzle.id}`,
          }}
        />
      </div>

      {solved ? (
        <>
          <div className="banner banner-turn" style={{ width: "100%" }}>
            {no.puzzle.solved}
          </div>
          <button className="btn btn-primary btn-block" onClick={next}>
            {no.puzzle.next} →
          </button>
        </>
      ) : wrong ? (
        <div className="banner banner-error" style={{ width: "100%" }}>
          {no.puzzle.wrong}
        </div>
      ) : (
        <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={next}>
          {no.puzzle.next}
        </button>
      )}
    </div>
  );
}
