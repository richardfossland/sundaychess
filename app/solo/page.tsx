"use client";

import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import { bestMove, type BotLevel } from "@/lib/chess/bot";
import { legalDestinations } from "@/lib/chess/validateMove";
import { Confetti } from "@/lib/client/Confetti";
import { ReplayBoard } from "@/lib/client/ReplayBoard";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { sound } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";

/** Audible cue for the move just played on `c`. */
function playMoveCue(c: Chess, captured: boolean) {
  sound.play(c.inCheck() ? "check" : captured ? "capture" : "move");
}

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

type Phase = "setup" | "game";
type Color = "white" | "black";
type Outcome = "win" | "loss" | "draw";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const LEVELS: { key: BotLevel; label: string }[] = [
  { key: "easy", label: no.solo.easy },
  { key: "medium", label: no.solo.medium },
  { key: "hard", label: no.solo.hard },
];

export default function Solo() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [colorPref, setColorPref] = useState<"white" | "black" | "random">("white");
  const [level, setLevel] = useState<BotLevel>("medium");
  const [playerColor, setPlayerColor] = useState<Color>("white");

  const chess = useRef(new Chess());
  const [fen, setFen] = useState(START);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [legal, setLegal] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [replayPgn, setReplayPgn] = useState<string | null>(null);

  const myLetter = playerColor === "white" ? "w" : "b";
  // Whose turn it is is derived from the rendered fen (not the mutable ref).
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const isMyTurn = !thinking && !outcome && turn === myLetter;

  const refresh = () => setFen(chess.current.fen());

  function settle(forColor: Color): boolean {
    const c = chess.current;
    if (!c.isGameOver()) return false;
    if (c.isCheckmate()) {
      const loserIsMe = c.turn() === (forColor === "white" ? "w" : "b");
      setOutcome(loserIsMe ? "loss" : "win");
      sound.play(loserIsMe ? "lose" : "win");
    } else {
      setOutcome("draw");
      sound.play("draw");
    }
    return true;
  }

  function botMove(forColor: Color) {
    setThinking(true);
    setSelected(null);
    setLegal([]);
    // Defer so the "thinking" state paints before the (synchronous) search.
    setTimeout(() => {
      const m = bestMove(chess.current.fen(), level);
      if (m) {
        const mv = chess.current.move({ from: m.from, to: m.to, promotion: m.promotion ?? "q" });
        setLastMove({ from: m.from, to: m.to });
        refresh();
        playMoveCue(chess.current, Boolean(mv?.captured));
      }
      setThinking(false);
      settle(forColor);
    }, 340);
  }

  function tryMove(from: string, to: string): boolean {
    if (!isMyTurn) return false;
    let captured = false;
    try {
      const mv = chess.current.move({ from, to, promotion: "q" });
      if (!mv) return false;
      captured = Boolean(mv.captured);
    } catch {
      return false;
    }
    setLastMove({ from, to });
    setSelected(null);
    setLegal([]);
    refresh();
    playMoveCue(chess.current, captured);
    if (settle(playerColor)) return true;
    botMove(playerColor);
    return true;
  }

  function start() {
    const color: Color =
      colorPref === "random" ? (Math.random() < 0.5 ? "white" : "black") : colorPref;
    setPlayerColor(color);
    chess.current = new Chess();
    setFen(chess.current.fen());
    setLastMove(null);
    setOutcome(null);
    setSelected(null);
    setLegal([]);
    setReplayPgn(null);
    setPhase("game");
    sound.play("start");
    if (color === "black") botMove(color); // computer (white) opens
  }

  function undo() {
    if (thinking) return;
    const c = chess.current;
    if (c.history().length === 0) return;
    c.undo(); // computer's reply
    if (c.history().length > 0 && c.turn() !== myLetter) c.undo(); // my move
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
    if (!isMyTurn) return;
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

  // ---------- setup ----------
  if (phase === "setup") {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack scale-in" style={{ alignItems: "stretch" }}>
          <div className="brandmark" style={{ justifyContent: "center" }}>
            <span className="knight">♞</span> Sunday<b>Chess</b>
          </div>
          <div className="text-center stack" style={{ gap: 4 }}>
            <p className="eyebrow">{no.solo.title}</p>
            <p className="faint" style={{ fontSize: 13 }}>{no.solo.subtitle}</p>
          </div>

          <div className="field">
            <label>{no.solo.chooseColor}</label>
            <div className="row">
              {(["white", "black", "random"] as const).map((c) => (
                <button
                  key={c}
                  className={`btn grow ${colorPref === c ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setColorPref(c)}
                >
                  {c === "white" ? `♔ ${no.solo.white}` : c === "black" ? `♚ ${no.solo.black}` : no.solo.random}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{no.solo.difficulty}</label>
            <div className="row">
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  className={`btn grow ${level === l.key ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setLevel(l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary btn-block btn-lg" onClick={start}>
            {no.solo.start} →
          </button>
          <Link href="/play" className="btn btn-ghost btn-block">
            {no.solo.back}
          </Link>
        </div>
      </main>
    );
  }

  // ---------- game ----------
  const squareStyles: Record<string, CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { background: "rgba(235,184,75,0.35)" };
    squareStyles[lastMove.to] = { background: "rgba(235,184,75,0.35)" };
  }
  if (selected) squareStyles[selected] = { background: "rgba(86,192,106,0.45)" };
  for (const sq of legal) {
    squareStyles[sq] = {
      ...(squareStyles[sq] ?? {}),
      backgroundImage: "radial-gradient(circle, rgba(86,192,106,0.7) 22%, transparent 24%)",
    };
  }

  const outText =
    outcome === "win" ? no.solo.youWon : outcome === "loss" ? no.solo.youLost : no.solo.draw;
  const outSub =
    outcome === "win" ? no.solo.wonSub : outcome === "loss" ? no.solo.lostSub : no.solo.drawSub;

  return (
    <main className="center-screen">
      {outcome === "win" && <Confetti count={120} />}
      <div className="stack" style={{ alignItems: "center", width: "100%", maxWidth: 600, gap: 16 }}>
        <div className="spread" style={{ width: "min(92vw,560px)" }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="avatar-lg">{no.solo.you[0]}</span>
            <b>{no.solo.you}</b>
          </div>
          <span className="faint" style={{ fontStyle: "italic" }}>vs</span>
          <div className="row" style={{ gap: 10 }}>
            <b>{no.solo.computer}</b>
            <span
              className="avatar-lg"
              style={{ background: "linear-gradient(180deg,var(--ink-soft),#1c212b)", color: "var(--txt)", border: "1px solid var(--ink-line-strong)" }}
            >
              🤖
            </span>
          </div>
        </div>

        {!outcome && (
          <div
            className={`banner ${isMyTurn ? "banner-turn" : "banner-wait"}`}
            style={{ width: "min(92vw,560px)" }}
            role="status"
            aria-live="polite"
          >
            {thinking ? no.solo.thinking : isMyTurn ? `♟ ${no.solo.yourTurn}` : no.solo.waiting}
          </div>
        )}

        <div className="board-frame">
          <div className="board-shell">
            <Chessboard
              options={{
                position: fen,
                boardOrientation: playerColor,
                allowDragging: isMyTurn,
                onPieceDrop: onDrop,
                onSquareClick,
                squareStyles,
                darkSquareStyle: { backgroundColor: "var(--board-dark)" },
                lightSquareStyle: { backgroundColor: "var(--board-light)" },
                animationDurationInMs: 180,
                id: "solo-board",
              }}
            />
          </div>
        </div>

        <div className="row">
          <button className="btn btn-ghost" onClick={undo} disabled={thinking}>
            ↶ {no.solo.undo}
          </button>
          <button className="btn" onClick={start} disabled={thinking}>
            {no.solo.newGame}
          </button>
          <Link href="/play" className="btn btn-ghost">
            {no.solo.back}
          </Link>
        </div>
      </div>

      {outcome && (
        <div className="result-overlay">
          {replayPgn !== null ? (
            <div className="result-card" style={{ maxWidth: 680, width: "100%" }}>
              <ReplayBoard
                pgn={replayPgn}
                orientation={playerColor}
                whiteName={playerColor === "white" ? no.solo.you : no.solo.computer}
                blackName={playerColor === "black" ? no.solo.you : no.solo.computer}
                onClose={() => setReplayPgn(null)}
              />
            </div>
          ) : (
            <div className="result-card stack" style={{ alignItems: "center", gap: 12 }}>
              <div className="result-emoji">
                {outcome === "win" ? "🎉" : outcome === "draw" ? "🤝" : "🤖"}
              </div>
              <h1 style={{ fontSize: "clamp(34px,8vw,60px)" }}>{outText}</h1>
              <p className="muted">{outSub}</p>
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn btn-primary btn-lg" onClick={start}>
                  {no.solo.newGame}
                </button>
                <Link href="/play" className="btn btn-lg">
                  {no.solo.back}
                </Link>
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

      <SoundToggle />
    </main>
  );
}
