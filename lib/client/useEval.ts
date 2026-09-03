"use client";

import { useEffect, useRef, useState } from "react";
import { requestEval } from "@/lib/client/engine";
import type { Evaluation, FenEval } from "@/lib/chess/evalBar";

// The eval bar and the hype callout are mounted side by side on the projector,
// both looking at the same position. Sharing the in-flight promise means one
// worker round-trip per move instead of two queued behind each other. Entries
// are dropped as soon as they settle, so this never grows.
const inFlight = new Map<string, Promise<Evaluation | null>>();

function evalOnce(fen: string, depth?: number): Promise<Evaluation | null> {
  const key = `${depth ?? ""}|${fen}`;
  const running = inFlight.get(key);
  if (running) return running;
  const p = requestEval(fen, depth).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * Evaluation of `fen`, computed in the engine Web Worker.
 *
 * Three rules, all of them there so a projector never stutters:
 *  - the PREVIOUS evaluation stays on screen while a new one is in flight, so
 *    the bar never flickers back to neutral mid-game;
 *  - a sequence guard drops out-of-order answers — spectated moves can arrive
 *    faster than the engine answers, and a stale eval must never win;
 *  - if the worker is unavailable or too slow, `requestEval` resolves null and
 *    we simply keep what we have (null on the very first position). There is no
 *    synchronous fallback anywhere on this path.
 *
 * Returns null until the first evaluation resolves.
 */
export function useEval(fen: string, depth?: number): FenEval | null {
  const [ev, setEv] = useState<FenEval | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!fen) return;
    const mine = ++seq.current;
    void evalOnce(fen, depth).then((r) => {
      if (!r || mine !== seq.current) return; // no answer, or a newer one won
      setEv({ fen, cp: r.cp, mate: r.mate });
    });
  }, [fen, depth]);

  return ev;
}
