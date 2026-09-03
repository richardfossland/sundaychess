"use client";

import { useEffect, useRef, useState } from "react";
import {
  CALLOUT_TONE,
  calloutFor,
  type CalloutKind,
  type CalloutTone,
  type FenEval,
} from "@/lib/chess/evalBar";
import { useEval } from "@/lib/client/useEval";
import { no } from "@/lib/locale/no";

// Engine-driven hype for the projector: compare the eval before and after each
// move and flash a callout over the board on big swings. Big-screen only —
// players never see it (it would leak the engine's opinion of their position).
//
// The evaluation comes from the engine Web Worker (useEval), so a spectated
// move costs the main thread nothing; the decision itself is the pure
// `calloutFor` in lib/chess/evalBar.ts.

interface Callout {
  id: number;
  text: string;
  tone: CalloutTone;
}

const TEXT: Record<CalloutKind, string> = {
  mate: no.hype.mate,
  swing: no.hype.swing,
  blunder: no.hype.blunder,
  brilliant: no.hype.brilliant,
};

export function HypeCallout({ fen }: { fen: string }) {
  const ev = useEval(fen);
  const prev = useRef<FenEval | null>(null);
  const idSeq = useRef(0);
  const [callout, setCallout] = useState<Callout | null>(null);

  useEffect(() => {
    if (!ev) return;
    const before = prev.current;
    if (before?.fen === ev.fen) return; // same position re-resolved
    prev.current = ev;

    const kind = calloutFor(before, ev);
    if (!kind) return;

    const id = ++idSeq.current;
    setCallout({ id, text: TEXT[kind], tone: CALLOUT_TONE[kind] });
    // Auto-hide; id-guarded so a newer callout is never cleared by an old timer.
    // Deliberately NOT cleaned up on re-run — cancelling it would strand the
    // banner when the next move produces no callout.
    setTimeout(() => setCallout((c) => (c?.id === id ? null : c)), 2600);
  }, [ev]);

  if (!callout) return null;
  return (
    <div key={callout.id} className={`hype-callout hype-${callout.tone}`} aria-live="polite">
      {callout.text}
    </div>
  );
}
