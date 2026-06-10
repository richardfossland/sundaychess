"use client";

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { evaluateFen } from "@/lib/chess/bot";
import { no } from "@/lib/locale/no";

// Engine-driven hype for the projector: compare the eval before and after each
// move and flash a callout over the board on big swings. Big-screen only —
// players never see it (it would leak the engine's opinion of their position).

interface Callout {
  id: number;
  text: string;
  tone: "good" | "bad" | "swing" | "mate";
}

/** Clamp mate scores so a single Δ threshold works near mate too. */
function clampCp(cp: number): number {
  return Math.max(-1200, Math.min(1200, cp));
}

export function HypeCallout({ fen }: { fen: string }) {
  const prev = useRef<{ fen: string; cp: number } | null>(null);
  const idSeq = useRef(0);
  const [callout, setCallout] = useState<Callout | null>(null);

  useEffect(() => {
    if (!fen) return;
    const before = prev.current;
    if (before?.fen === fen) return;

    let chess: Chess | null = null;
    try {
      chess = new Chess(fen);
    } catch {
      return;
    }

    const { cp, mate } = evaluateFen(fen);
    const cpC = clampCp(cp);
    const next = { fen, cp: cpC };

    // First position seen → just remember it.
    if (!before) {
      prev.current = next;
      return;
    }
    prev.current = next;

    let text: string | null = null;
    let tone: Callout["tone"] = "swing";

    const moverIsWhite = before.fen.split(" ")[1] === "w";
    // Δ from the mover's perspective: positive = the move improved their game.
    const delta = (cpC - before.cp) * (moverIsWhite ? 1 : -1);
    const crossed =
      (before.cp > 120 && cpC < -120) || (before.cp < -120 && cpC > 120);

    if (mate != null && chess.isCheckmate()) {
      text = no.hype.mate;
      tone = "mate";
    } else if (crossed) {
      text = no.hype.swing;
      tone = "swing";
    } else if (delta <= -260) {
      text = no.hype.blunder;
      tone = "bad";
    } else if (delta >= 260) {
      text = no.hype.brilliant;
      tone = "good";
    }

    if (!text) return;
    const id = ++idSeq.current;
    setCallout({ id, text, tone });
    // Auto-hide; id-guarded so a newer callout is never cleared by an old timer.
    // Deliberately NOT cleaned up on re-run — cancelling it would strand the
    // banner when the next move produces no callout.
    setTimeout(() => setCallout((c) => (c?.id === id ? null : c)), 2600);
  }, [fen]);

  if (!callout) return null;
  return (
    <div key={callout.id} className={`hype-callout hype-${callout.tone}`} aria-live="polite">
      {callout.text}
    </div>
  );
}
