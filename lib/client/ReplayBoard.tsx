"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import { BOARD_BASE_OPTIONS, highlightStyles } from "@/lib/client/boardOptions";
import { useReducedMotion } from "@/lib/client/useReducedMotion";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

interface ParsedGame {
  /** start position (variant-aware: read from the first move, so PGNs with a
   * [FEN] header replay from the right board) */
  startFen: string;
  plies: { fen: string; san: string; from: string; to: string }[];
}

/** Parse a PGN into per-ply positions. Returns null if the PGN is empty or
 * unparseable (e.g. an overridden game with no moves). */
function parsePgn(pgn: string): ParsedGame | null {
  if (!pgn.trim()) return null;
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const hist = chess.history({ verbose: true });
  if (hist.length === 0) return null;
  return {
    startFen: hist[0].before,
    plies: hist.map((m) => ({ fen: m.after, san: m.san, from: m.from, to: m.to })),
  };
}

/** Step-through replay of a finished game. `idx` 0 = start position,
 * n = position after move n. Arrow keys work; autoplay advances 1 move/s. */
export function ReplayBoard({
  pgn,
  orientation = "white",
  whiteName,
  blackName,
  onClose,
}: {
  pgn: string;
  orientation?: "white" | "black";
  whiteName: string;
  blackName: string;
  onClose: () => void;
}) {
  const parsed = useMemo(() => parsePgn(pgn), [pgn]);
  const plies = parsed?.plies ?? null;
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = plies?.length ?? 0;

  // jump to the end when opened, so the final position greets you first
  const initialised = useRef(false);
  useEffect(() => {
    if (!initialised.current && total > 0) {
      initialised.current = true;
      setIdx(total);
    }
  }, [total]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIdx((i) => {
        if (i >= total) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [playing, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(total, i + 1));
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, onClose]);

  const reducedMotion = useReducedMotion();

  if (!plies) {
    return (
      <div className="stack text-center result-stack">
        <p className="muted">{no.replay.empty}</p>
        <button className="btn btn-ghost" onClick={onClose}>
          <Icon name="back" size={16} /> {no.common.back}
        </button>
      </div>
    );
  }

  const fen = idx === 0 ? parsed!.startFen : plies[idx - 1].fen;
  const last = idx > 0 ? plies[idx - 1] : null;
  const squareStyles = highlightStyles({ last });

  return (
    <div className="stack result-stack replay">
      <div className="spread replay-head">
        <b>{whiteName}</b>
        <span className="muted">{no.player.vs}</span>
        <b>{blackName}</b>
      </div>

      <div className="board-frame">
        <div className="board-shell board-shell-replay">
          <Chessboard
            options={{
              ...BOARD_BASE_OPTIONS,
              position: fen,
              boardOrientation: orientation,
              allowDragging: false,
              showAnimations: !reducedMotion,
              squareStyles,
              animationDurationInMs: 150,
              id: "replay-board",
            }}
          />
        </div>
      </div>

      <div className="row gap-2">
        <button className="btn" onClick={() => setIdx(0)} disabled={idx === 0} aria-label="til start">
          <Icon name="skipBack" size={16} />
        </button>
        <button
          className="btn"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          aria-label="forrige trekk"
        >
          <Icon name="backStep" size={16} />
        </button>
        <button
          className="btn btn-primary replay-play"
          onClick={() => {
            if (idx >= total) setIdx(0);
            setPlaying((p) => !p);
          }}
        >
          <Icon name={playing ? "pause" : "play"} size={16} /> {playing ? no.replay.pause : no.replay.play}
        </button>
        <button
          className="btn"
          onClick={() => setIdx((i) => Math.min(total, i + 1))}
          disabled={idx >= total}
          aria-label="neste trekk"
        >
          <Icon name="play" size={16} />
        </button>
        <button className="btn" onClick={() => setIdx(total)} disabled={idx >= total} aria-label="til slutt">
          <Icon name="skipForward" size={16} />
        </button>
      </div>

      <p className="muted mono fs-sm">
        {no.replay.move} {idx} / {total}
        {last && (
          <>
            {" · "}
            <b className="text-gold">{last.san}</b>
          </>
        )}
      </p>

      <button className="btn btn-ghost" onClick={onClose}>
        <Icon name="back" size={16} /> {no.common.back}
      </button>
    </div>
  );
}
