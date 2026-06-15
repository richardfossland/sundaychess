"use client";

// Client gateway to the chess engine. Prefers an off-thread Web Worker so the
// bot's think never freezes the tab; if the worker can't be created (old
// browser / SSR / bundling issue) or fails to answer, it falls back to a
// node-budget-bounded synchronous search on the main thread. Either way the UI
// stays responsive and always gets a move.

import {
  bestMove,
  bestMoveBySkill,
  bestMoveStrong,
  type BotLevel,
} from "@/lib/chess/bot";
import type { MoveIntent } from "@/lib/chess/validateMove";

export type BotRequest = { fen: string } & (
  | { mode: "skill"; skill: number }
  | { mode: "level"; level: BotLevel }
);

// undefined = not tried yet, null = unavailable (use the fallback).
let worker: Worker | null | undefined;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL("../chess/engine.worker.ts", import.meta.url), {
      type: "module",
    });
    // If the worker module fails to load or errors, demote permanently to the
    // synchronous fallback — otherwise every later move would post to a dead
    // worker and eat the full timeout before falling back.
    w.onerror = () => {
      worker = null;
    };
    w.onmessageerror = () => {
      worker = null;
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Smaller node budget for the synchronous fallback so it stays snappy on the
 * main thread; the worker path uses the engine's larger default. */
function fallback(req: BotRequest): Promise<MoveIntent | null> {
  if (req.mode === "skill") return Promise.resolve(bestMoveBySkill(req.fen, req.skill));
  if (req.level === "impossible") return bestMoveStrong(req.fen, Math.random, 40_000);
  return Promise.resolve(bestMove(req.fen, req.level));
}

let seq = 0;

/** Get the bot's move for a position. Always resolves (never rejects). */
export function requestBotMove(req: BotRequest): Promise<MoveIntent | null> {
  const w = getWorker();
  if (!w) return fallback(req);

  return new Promise((resolve) => {
    const id = ++seq;
    let settled = false;
    const finish = (move: MoveIntent | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.removeEventListener("message", onMsg);
      resolve(move);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { id?: number; move?: MoveIntent | null };
      if (d && d.id === id) finish(d.move ?? null);
    };
    // If the worker dies or never replies, demote it (so the NEXT move skips it
    // instead of waiting another 5s) and compute on the main thread now.
    const timer = setTimeout(() => {
      worker = null;
      void fallback(req).then(finish);
    }, 5000);
    w.addEventListener("message", onMsg);
    w.postMessage({ id, ...req });
  });
}
