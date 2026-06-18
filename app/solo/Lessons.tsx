"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import { LESSONS, checkLessonGoal, type Lesson } from "@/lib/coach/lessons";
import { legalDestinations } from "@/lib/chess/validateMove";
import { Confetti } from "@/lib/client/Confetti";
import { sound } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

/** Solo "Lær"-mode: a list of one-move lessons, each run on a guided board. */
export function Lessons({ onExit }: { onExit: () => void }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (activeIdx === null) {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack scale-in" style={{ alignItems: "stretch", maxWidth: 460 }}>
          <div className="text-center stack" style={{ gap: 4 }}>
            <p className="eyebrow">{no.coach.lessonsTitle}</p>
            <p className="faint" style={{ fontSize: 13 }}>{no.coach.lessonsIntro}</p>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {LESSONS.map((l, i) => (
              <button
                key={l.id}
                className="card stack"
                style={{ padding: 14, textAlign: "left", cursor: "pointer", gap: 2 }}
                onClick={() => setActiveIdx(i)}
              >
                <b style={{ fontSize: 16 }}>{l.title}</b>
                <span className="faint" style={{ fontSize: 13 }}>{l.blurb}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-block" onClick={onExit}>
            {no.solo.back}
          </button>
        </div>
      </main>
    );
  }

  return (
    <LessonRunner
      key={LESSONS[activeIdx].id}
      lesson={LESSONS[activeIdx]}
      hasNext={activeIdx < LESSONS.length - 1}
      onNext={() => setActiveIdx((i) => (i === null ? null : i + 1))}
      onList={() => setActiveIdx(null)}
    />
  );
}

function LessonRunner({
  lesson,
  hasNext,
  onNext,
  onList,
}: {
  lesson: Lesson;
  hasNext: boolean;
  onNext: () => void;
  onList: () => void;
}) {
  const moverColor: "white" | "black" =
    lesson.fen.split(" ")[1] === "b" ? "black" : "white";
  const [fen, setFen] = useState(lesson.fen);
  const [selected, setSelected] = useState<string | null>(null);
  const [legal, setLegal] = useState<string[]>([]);
  const [status, setStatus] = useState<"playing" | "done" | "retry">("playing");

  function attempt(from: string, to: string): boolean {
    if (status !== "playing") return false;
    const chess = new Chess(lesson.fen);
    let mv;
    try {
      mv = chess.move({ from, to, promotion: "q" });
    } catch {
      return false;
    }
    if (!mv) return false;
    setFen(chess.fen());
    setSelected(null);
    setLegal([]);
    if (checkLessonGoal(lesson.goal, lesson.fen, { from, to })) {
      setStatus("done");
      sound.play("win");
    } else {
      setStatus("retry");
      sound.play("lose");
      // bounce back to the start position so they can try again
      setTimeout(() => {
        setFen(lesson.fen);
        setStatus("playing");
      }, 1000);
    }
    return true;
  }

  function onDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false;
    return attempt(sourceSquare, targetSquare);
  }
  function onSquareClick({ square, piece }: SquareHandlerArgs) {
    if (status !== "playing") return;
    if (selected && legal.includes(square)) {
      attempt(selected, square);
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
  if (selected) squareStyles[selected] = { background: "rgba(86,192,106,0.45)" };
  for (const sq of legal) {
    squareStyles[sq] = {
      ...(squareStyles[sq] ?? {}),
      backgroundImage: "radial-gradient(circle, rgba(86,192,106,0.7) 22%, transparent 24%)",
    };
  }

  return (
    <main className="center-screen">
      {status === "done" && <Confetti count={110} />}
      <div className="stack" style={{ alignItems: "center", width: "100%", maxWidth: 560, gap: 14 }}>
        <div className="text-center stack" style={{ gap: 2 }}>
          <p className="eyebrow">{lesson.title}</p>
          <p className="faint" style={{ fontSize: 13 }}>{lesson.blurb}</p>
        </div>

        <div
          className={`banner ${status === "done" ? "banner-turn" : status === "retry" ? "banner-error" : "banner-wait"}`}
          style={{ width: "min(92vw,520px)" }}
          role="status"
          aria-live="polite"
        >
          {status === "done"
            ? no.coach.lessonDone
            : status === "retry"
              ? no.coach.lessonRetry
              : `${no.coach.hint}: ${lesson.hint}`}
        </div>

        <div className="board-frame">
          <div className="board-shell">
            <Chessboard
              options={{
                position: fen,
                boardOrientation: moverColor,
                allowDragging: status === "playing",
                onPieceDrop: onDrop,
                onSquareClick,
                squareStyles,
                darkSquareStyle: { backgroundColor: "var(--board-dark)" },
                lightSquareStyle: { backgroundColor: "var(--board-light)" },
                animationDurationInMs: 160,
                id: "lesson-board",
              }}
            />
          </div>
        </div>

        <div className="row">
          {status === "done" && hasNext && (
            <button className="btn btn-primary" onClick={onNext}>
              {no.coach.next}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onList}>
            {no.coach.backToList}
          </button>
          <Link href="/" className="btn btn-ghost">
            {no.solo.back}
          </Link>
        </div>
      </div>
    </main>
  );
}
