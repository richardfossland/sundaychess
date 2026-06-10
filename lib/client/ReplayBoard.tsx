"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import { no } from "@/lib/locale/no";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface Ply {
  fen: string;
  san: string;
  from: string;
  to: string;
}

/** Parse a PGN into per-ply positions. Returns null if the PGN is empty or
 * unparseable (e.g. an overridden game with no moves). */
function parsePgn(pgn: string): Ply[] | null {
  if (!pgn.trim()) return null;
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const hist = chess.history({ verbose: true });
  if (hist.length === 0) return null;
  return hist.map((m) => ({ fen: m.after, san: m.san, from: m.from, to: m.to }));
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
  const plies = useMemo(() => parsePgn(pgn), [pgn]);
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

  if (!plies) {
    return (
      <div className="stack text-center" style={{ alignItems: "center", gap: 12 }}>
        <p className="muted">{no.replay.empty}</p>
        <button className="btn btn-ghost" onClick={onClose}>
          ← {no.common.back}
        </button>
      </div>
    );
  }

  const fen = idx === 0 ? START_FEN : plies[idx - 1].fen;
  const last = idx > 0 ? plies[idx - 1] : null;
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (last) {
    squareStyles[last.from] = { background: "rgba(235,184,75,0.35)" };
    squareStyles[last.to] = { background: "rgba(235,184,75,0.35)" };
  }

  return (
    <div className="stack" style={{ alignItems: "center", gap: 12, width: "100%" }}>
      <div className="spread" style={{ width: "100%", maxWidth: 560 }}>
        <b>{whiteName}</b>
        <span className="muted">{no.player.vs}</span>
        <b>{blackName}</b>
      </div>

      <div className="board-frame">
        <div className="board-shell" style={{ width: "min(94vw, 62vh, 560px)" }}>
          <Chessboard
            options={{
              position: fen,
              boardOrientation: orientation,
              allowDragging: false,
              squareStyles,
              darkSquareStyle: { backgroundColor: "var(--board-dark)" },
              lightSquareStyle: { backgroundColor: "var(--board-light)" },
              animationDurationInMs: 150,
              id: "replay-board",
            }}
          />
        </div>
      </div>

      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <button className="btn" onClick={() => setIdx(0)} disabled={idx === 0} aria-label="til start">
          ⏮
        </button>
        <button
          className="btn"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          aria-label="forrige trekk"
        >
          ◀
        </button>
        <button
          className="btn btn-primary"
          style={{ minWidth: 110 }}
          onClick={() => {
            if (idx >= total) setIdx(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? no.replay.pause : no.replay.play}
        </button>
        <button
          className="btn"
          onClick={() => setIdx((i) => Math.min(total, i + 1))}
          disabled={idx >= total}
          aria-label="neste trekk"
        >
          ▶
        </button>
        <button className="btn" onClick={() => setIdx(total)} disabled={idx >= total} aria-label="til slutt">
          ⏭
        </button>
      </div>

      <p className="muted mono" style={{ fontSize: 14 }}>
        {no.replay.move} {idx} / {total}
        {last && (
          <>
            {" · "}
            <b style={{ color: "var(--gold)" }}>{last.san}</b>
          </>
        )}
      </p>

      <button className="btn btn-ghost" onClick={onClose}>
        ← {no.common.back}
      </button>
    </div>
  );
}
