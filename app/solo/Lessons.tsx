"use client";

import { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import { LESSONS, checkLessonGoal, type Lesson } from "@/lib/coach/lessons";
import { legalDestinations } from "@/lib/chess/validateMove";
import { BOARD_BASE_OPTIONS } from "@/lib/client/boardOptions";
import { Confetti } from "@/lib/client/Confetti";
import { sound } from "@/lib/client/sound";
import { safeGet, safeSet } from "@/lib/client/storage";
import { no } from "@/lib/locale/no";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

/** Lesson ids the player has solved, comma-separated. Best-effort: storage can
 *  be blocked (Safari "Block All Cookies"), in which case progress simply
 *  stays in memory for the session — see lib/client/storage.ts. */
const DONE_KEY = "sjakk:lessons-done";

function readDone(): string[] {
  const raw = safeGet(DONE_KEY);
  if (!raw) return [];
  return raw.split(",").filter(Boolean);
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, key) => String(values[key] ?? m));
}

/** Solo "Lær"-mode: a list of one-move lessons, each run on a guided board. */
export function Lessons({ onExit }: { onExit: () => void }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  // Safe to read storage in the initializer: this screen only mounts after the
  // player taps "Lær sjakk" on the solo page, so it never renders during SSR
  // and can't produce a hydration mismatch. safeGet degrades to null when
  // storage is blocked, and the list simply shows no ticks.
  const [done, setDone] = useState<string[]>(readDone);

  const markDone = useCallback((id: string) => {
    setDone((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      safeSet(DONE_KEY, next.join(",")); // best-effort; state stays in memory either way
      return next;
    });
  }, []);

  if (activeIdx === null) {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack scale-in" style={{ alignItems: "stretch", maxWidth: 460 }}>
          <div className="text-center stack" style={{ gap: 4 }}>
            <p className="eyebrow">{no.coach.lessonsTitle}</p>
            <p className="faint" style={{ fontSize: 13 }}>{no.coach.lessonsIntro}</p>
            <p className="faint" style={{ fontSize: 12 }}>
              {fill(no.coach.lessonsProgress, { n: done.length, total: LESSONS.length })}
            </p>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {LESSONS.map((l, i) => {
              const solved = done.includes(l.id);
              return (
                <button
                  key={l.id}
                  className="card row"
                  style={{ padding: 14, textAlign: "left", cursor: "pointer", gap: 10, alignItems: "flex-start" }}
                  onClick={() => setActiveIdx(i)}
                >
                  <span
                    aria-hidden={!solved}
                    aria-label={solved ? no.coach.lessonSolvedLabel : undefined}
                    style={{ width: 18, flex: "0 0 18px", fontSize: 15, lineHeight: "22px", textAlign: "center" }}
                  >
                    {solved ? "✓" : ""}
                  </span>
                  <span className="stack" style={{ gap: 2 }}>
                    <b style={{ fontSize: 16 }}>
                      {i + 1}. {l.title}
                    </b>
                    <span className="faint" style={{ fontSize: 13 }}>{l.blurb}</span>
                  </span>
                </button>
              );
            })}
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
      index={activeIdx}
      total={LESSONS.length}
      hasNext={activeIdx < LESSONS.length - 1}
      onSolved={markDone}
      onNext={() => setActiveIdx((i) => (i === null ? null : i + 1))}
      onList={() => setActiveIdx(null)}
    />
  );
}

function LessonRunner({
  lesson,
  index,
  total,
  hasNext,
  onSolved,
  onNext,
  onList,
}: {
  lesson: Lesson;
  index: number;
  total: number;
  hasNext: boolean;
  onSolved: (id: string) => void;
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
      onSolved(lesson.id);
    } else {
      // Leave the wrong move ON the board with the hint showing, and wait for a
      // tap. An automatic bounce-back after a second snatched the position away
      // before a 10-year-old could see what went wrong.
      setStatus("retry");
      sound.play("lose");
    }
    return true;
  }

  function retry() {
    setFen(lesson.fen);
    setSelected(null);
    setLegal([]);
    setStatus("playing");
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
    <main className="center-screen is-game">
      {status === "done" && <Confetti count={110} />}
      <div className="stack" style={{ alignItems: "center", width: "100%", maxWidth: 560, gap: 14 }}>
        <div className="text-center stack" style={{ gap: 2 }}>
          <p className="faint" style={{ fontSize: 12 }}>
            {fill(no.coach.lessonProgress, { n: index + 1, total })}
          </p>
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
              ? `${no.coach.lessonRetry} ${no.coach.hint}: ${lesson.hint}`
              : `${no.coach.hint}: ${lesson.hint}`}
        </div>

        <div className="board-frame">
          <div className="board-shell">
            <Chessboard
              options={{
                ...BOARD_BASE_OPTIONS,
                position: fen,
                boardOrientation: moverColor,
                allowDragging: status === "playing",
                onPieceDrop: onDrop,
                onSquareClick,
                squareStyles,
                animationDurationInMs: 160,
                id: "lesson-board",
              }}
            />
          </div>
        </div>

        <div className="row">
          {status === "retry" && (
            <button className="btn btn-primary" onClick={retry}>
              {no.coach.lessonTryAgain}
            </button>
          )}
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
