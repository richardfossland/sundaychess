"use client";

import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import type { BotLevel } from "@/lib/chess/bot";
import { requestBotMove } from "@/lib/client/engine";
import { moveAdvice, type AdviceKind } from "@/lib/chess/coach";
import {
  botSkillForPlayer,
  outcomeToScore,
  updateRating,
  type RatingState,
} from "@/lib/chess/skill";
import { identity } from "@/lib/client/identity";
import { legalDestinations } from "@/lib/chess/validateMove";
import { Confetti } from "@/lib/client/Confetti";
import { EvalBar } from "@/lib/client/EvalBar";
import { ReplayBoard } from "@/lib/client/ReplayBoard";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { sound } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";
import { SoloReview } from "./SoloReview";
import { Lessons } from "./Lessons";

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

// "adaptive" tunes the bot to the player's rating; the others are fixed levels.
type Difficulty = "adaptive" | BotLevel;

// Solo can be played plain, with a coach, or as guided lessons.
type Mode = "normal" | "coach";
type CoachLevel = "laer" | "ovning" | "mester";

/** What each coach level turns on: the bot it plays, whether to warn before a
 * blunder, show the eval bar, tag moves (+ offer a do-over), and review after. */
interface CoachCfg {
  bot: Difficulty;
  warn: boolean;
  evalBar: boolean;
  tag: boolean;
  review: boolean;
}
const COACH: Record<CoachLevel, CoachCfg> = {
  laer: { bot: "easy", warn: true, evalBar: false, tag: false, review: false },
  ovning: { bot: "adaptive", warn: false, evalBar: true, tag: true, review: true },
  mester: { bot: "impossible", warn: false, evalBar: true, tag: false, review: true },
};

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const LEVELS: { key: Difficulty; label: string }[] = [
  { key: "adaptive", label: no.solo.adaptive },
  { key: "easy", label: no.solo.easy },
  { key: "medium", label: no.solo.medium },
  { key: "hard", label: no.solo.hard },
  { key: "impossible", label: no.solo.impossible },
];

const COACH_LEVELS: { key: CoachLevel; label: string; sub: string }[] = [
  { key: "laer", label: no.coach.laer, sub: no.coach.laerSub },
  { key: "ovning", label: no.coach.ovning, sub: no.coach.ovningSub },
  { key: "mester", label: no.coach.mester, sub: no.coach.mesterSub },
];

export default function Solo() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [colorPref, setColorPref] = useState<"white" | "black" | "random">("white");
  const [level, setLevel] = useState<Difficulty>("adaptive");
  const [playerColor, setPlayerColor] = useState<Color>("white");

  // Adaptive rating (client-only, persisted per device). `botSkill` is locked
  // in at the start of each game; `ratingDelta` reports the post-game change.
  // Lazy initializer: localStorage is read once, on the client, on first
  // render (identity.soloRating() returns the initial rating if unavailable,
  // e.g. during SSR, so there is no hydration mismatch on a fresh device).
  const [rating, setRating] = useState<RatingState>(() => identity.soloRating());
  const botSkill = useRef(0);
  const [ratingDelta, setRatingDelta] = useState<number | null>(null);

  const chess = useRef(new Chess());
  const [fen, setFen] = useState(START);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [legal, setLegal] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [replayPgn, setReplayPgn] = useState<string | null>(null);

  // Coach mode + lessons.
  const [mode, setMode] = useState<Mode>("normal");
  const [coachLevel, setCoachLevel] = useState<CoachLevel>("laer");
  const [showLessons, setShowLessons] = useState(false);
  const [coachTag, setCoachTag] = useState<AdviceKind | null>(null);
  const [awaitRetry, setAwaitRetry] = useState(false); // "bli bedre" blunder pause
  const [reviewPgn, setReviewPgn] = useState<string | null>(null);
  const coachCfg: CoachCfg | null = mode === "coach" ? COACH[coachLevel] : null;

  const myLetter = playerColor === "white" ? "w" : "b";
  // Whose turn it is is derived from the rendered fen (not the mutable ref).
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const isMyTurn = !thinking && !outcome && !awaitRetry && turn === myLetter;

  const refresh = () => setFen(chess.current.fen());

  // After an adaptive game, move the device rating toward/away from the bot's
  // rating (auto-tune toward a ~50% win rate) and persist it. Pure update lives
  // in lib/chess/skill.ts; this only handles state + storage side effects.
  function recordAdaptiveResult(result: Outcome) {
    if (level !== "adaptive") return;
    const next = updateRating(rating, botSkill.current, outcomeToScore(result));
    setRatingDelta(next.rating - rating.rating);
    setRating(next);
    identity.saveSoloRating(next);
  }

  function settle(forColor: Color): boolean {
    const c = chess.current;
    if (!c.isGameOver()) return false;
    if (c.isCheckmate()) {
      const loserIsMe = c.turn() === (forColor === "white" ? "w" : "b");
      setOutcome(loserIsMe ? "loss" : "win");
      sound.play(loserIsMe ? "lose" : "win");
      recordAdaptiveResult(loserIsMe ? "loss" : "win");
    } else {
      setOutcome("draw");
      sound.play("draw");
      recordAdaptiveResult("draw");
    }
    return true;
  }

  function botMove(forColor: Color) {
    setThinking(true);
    setSelected(null);
    setLegal([]);
    // Off-thread via the engine Web Worker (with a synchronous fallback), so even
    // the "umulig" search never freezes the tab. All in-game controls are
    // disabled while `thinking`, so there is no stale-result race to guard.
    const fenNow = chess.current.fen();
    const req =
      level === "adaptive"
        ? ({ mode: "skill", fen: fenNow, skill: botSkill.current } as const)
        : ({ mode: "level", fen: fenNow, level } as const);
    requestBotMove(req)
      .then((m) => {
        try {
          if (m) {
            const mv = chess.current.move({ from: m.from, to: m.to, promotion: m.promotion ?? "q" });
            setLastMove({ from: m.from, to: m.to });
            refresh();
            playMoveCue(chess.current, Boolean(mv?.captured));
          }
          setCoachTag(null); // my next turn starts fresh
          settle(forColor);
        } finally {
          // Solo has no poll/watchdog — guarantee we never get stuck on "tenker…".
          setThinking(false);
        }
      })
      .catch(() => setThinking(false));
  }

  function tryMove(from: string, to: string): boolean {
    if (!isMyTurn) return false;
    const fenBefore = chess.current.fen();

    // Beginner coach: warn BEFORE committing an obvious blunder.
    if (coachCfg?.warn && moveAdvice(fenBefore, { from, to }).kind === "blunder") {
      if (!confirm(no.coach.warn)) return false;
    }

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

    // "Bli bedre" coach: tag the move; on a blunder, PAUSE before the bot
    // replies and offer a do-over.
    if (coachCfg?.tag) {
      const adv = moveAdvice(fenBefore, { from, to });
      setCoachTag(adv.kind);
      if (adv.kind === "blunder" && !chess.current.isGameOver()) {
        setAwaitRetry(true);
        return true; // wait for retry / keep-playing choice
      }
    }

    if (settle(playerColor)) return true;
    botMove(playerColor);
    return true;
  }

  /** Take back the just-played (blundering) move and let the player try again. */
  function retryBlunder() {
    chess.current.undo();
    setAwaitRetry(false);
    setCoachTag(null);
    setLastMove(null);
    refresh();
  }

  /** Keep the move despite the warning and let the bot reply. */
  function keepBlunder() {
    setAwaitRetry(false);
    if (settle(playerColor)) return;
    botMove(playerColor);
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
    setRatingDelta(null);
    setCoachTag(null);
    setAwaitRetry(false);
    setReviewPgn(null);
    // Lock the bot's strength for this game to the player's current rating, so
    // the matchup is an even ~50% (it re-tunes from the post-game rating).
    botSkill.current = botSkillForPlayer(rating);
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
    // If the undo landed on the computer's turn, it must re-move or the board
    // soft-locks (nothing else re-triggers it). This happens when Black undoes
    // White's opening: the history empties, the second undo is skipped, and the
    // position sits on White (the computer) to move. Re-open for the computer.
    if (!c.isGameOver() && c.turn() !== myLetter) botMove(playerColor);
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

  // ---------- lessons ----------
  if (showLessons) {
    return <Lessons onExit={() => setShowLessons(false)} />;
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

          {/* play with or without a coach */}
          <div className="row">
            <button
              className={`btn grow ${mode === "normal" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setMode("normal")}
            >
              {no.coach.modeNormal}
            </button>
            <button
              className={`btn grow ${mode === "coach" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => {
                setMode("coach");
                setLevel(COACH[coachLevel].bot);
              }}
            >
              {no.coach.modeCoach}
            </button>
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

          {mode === "normal" ? (
            <div className="field">
              <label>{no.solo.difficulty}</label>
              {/* grid (not a row) so 5 levels wrap cleanly on mobile and labels
                  never clip against .btn's overflow:hidden */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 8 }}>
                {LEVELS.map((l) => (
                  <button
                    key={l.key}
                    className={`btn ${level === l.key ? "btn-primary" : "btn-ghost"}`}
                    style={{ padding: "10px 8px" }}
                    onClick={() => setLevel(l.key)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              {level === "adaptive" && (
                <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                  {no.solo.adaptiveHint}
                  {` · ${no.solo.yourLevel}: ${rating.rating}`}
                </p>
              )}
            </div>
          ) : (
            <div className="field">
              <label>{no.coach.level}</label>
              <div className="stack" style={{ gap: 8 }}>
                {COACH_LEVELS.map((l) => (
                  <button
                    key={l.key}
                    className={`btn ${coachLevel === l.key ? "btn-primary" : "btn-ghost"}`}
                    // .btn is inline-block, so set display:flex explicitly to make
                    // the label + sub-text stack (instead of running together).
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 3,
                      padding: "12px 16px",
                      textAlign: "left",
                      whiteSpace: "normal",
                      width: "100%",
                    }}
                    onClick={() => {
                      setCoachLevel(l.key);
                      setLevel(COACH[l.key].bot);
                    }}
                  >
                    <b style={{ fontSize: 15 }}>{l.label}</b>
                    <span className="faint" style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.3 }}>
                      {l.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-primary btn-block btn-lg" onClick={start}>
            {no.solo.start} →
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setShowLessons(true)}>
            {no.coach.lessons}
          </button>
          <Link href="/" className="btn btn-ghost btn-block">
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

        <div className="row" style={{ gap: 12, alignItems: "stretch", justifyContent: "center" }}>
          {coachCfg?.evalBar && <EvalBar fen={fen} />}
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
        </div>

        {/* coach: tag the move just played, and pause for a do-over on a blunder */}
        {coachTag && !awaitRetry && !outcome && (
          <div
            className={`banner ${coachTag === "blunder" ? "banner-error" : coachTag === "inaccuracy" ? "banner-wait" : "banner-turn"}`}
            style={{ width: "min(92vw,560px)" }}
            role="status"
            aria-live="polite"
          >
            {coachTag === "blunder"
              ? no.coach.tagBlunder
              : coachTag === "inaccuracy"
                ? no.coach.tagInaccuracy
                : no.coach.tagGood}
          </div>
        )}
        {awaitRetry && (
          <div className="card stack" style={{ padding: 14, width: "min(92vw,560px)", gap: 8 }}>
            <p>{no.coach.tagBlunder}</p>
            <div className="row">
              <button className="btn btn-primary grow" onClick={retryBlunder}>
                {no.coach.retry}
              </button>
              <button className="btn grow" onClick={keepBlunder}>
                {no.coach.keep}
              </button>
            </div>
          </div>
        )}

        <div className="row">
          <button className="btn btn-ghost" onClick={undo} disabled={thinking || awaitRetry}>
            ↶ {no.solo.undo}
          </button>
          <button className="btn" onClick={start} disabled={thinking}>
            {no.solo.newGame}
          </button>
          <Link href="/" className="btn btn-ghost">
            {no.solo.back}
          </Link>
        </div>
      </div>

      {outcome && (
        <div className="result-overlay">
          {reviewPgn !== null ? (
            <SoloReview
              pgn={reviewPgn}
              playerColor={playerColor}
              onClose={() => setReviewPgn(null)}
            />
          ) : replayPgn !== null ? (
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
              {level === "adaptive" && ratingDelta !== null && (
                <p className="faint" style={{ fontSize: 13 }}>
                  {ratingDelta > 0
                    ? no.solo.levelUp
                    : ratingDelta < 0
                      ? no.solo.levelDown
                      : no.solo.levelSame}{" "}
                  · {no.solo.yourLevel}: {rating.rating}
                  {ratingDelta !== 0 ? ` (${ratingDelta > 0 ? "+" : ""}${ratingDelta})` : ""}
                </p>
              )}
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn btn-primary btn-lg" onClick={start}>
                  {no.solo.newGame}
                </button>
                <Link href="/" className="btn btn-lg">
                  {no.solo.back}
                </Link>
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => setReplayPgn(chess.current.pgn())}
              >
                ♟ {no.replay.cta}
              </button>
              {coachCfg?.review && (
                <button className="btn btn-ghost" onClick={() => setReviewPgn(chess.current.pgn())}>
                  {no.coach.review}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <SoundToggle />
    </main>
  );
}
