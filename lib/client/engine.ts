"use client";

// Client gateway to the chess engine. Everything that searches — the bot's
// move, the coach's advice, the spectator evaluation — is posted to an
// off-thread Web Worker so it never freezes the tab.
//
// The three callers have deliberately different failure rules:
//
//   requestBotMove  the game cannot continue without a move, so if the worker
//                   is missing or silent it falls back to a node-budgeted
//                   synchronous search on the main thread.
//   requestAdvice   the coach can afford to miss: the caller re-derives the one
//                   move it actually needs (see app/solo/page.tsx).
//   requestEval     NEVER falls back. A neutral eval bar beats a 300 ms freeze
//                   on the projector, every time.

import {
  bestMove,
  bestMoveBySkill,
  bestMoveStrong,
  type BotLevel,
} from "@/lib/chess/bot";
import type { AdviceMap } from "@/lib/chess/coach";
import type { Evaluation } from "@/lib/chess/evalBar";
import type { EngineRequestBody } from "@/lib/chess/engineProtocol";
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

// One counter for every request type: ids must be unique across the single
// worker port, or an advice reply could be mistaken for a bot reply.
let seq = 0;

/**
 * Post `payload` to the worker and resolve with `read(reply)`.
 *
 * Resolves `null` if the worker is unavailable or does not answer within
 * `timeoutMs` — and, unlike the bot path, does NOT demote the worker on a
 * timeout: a late answer here usually means the worker is busy thinking about
 * the bot's move, not that it is dead.
 */
function ask<T>(
  payload: EngineRequestBody,
  read: (data: Record<string, unknown>) => T | null,
  timeoutMs: number,
): Promise<T | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);

  return new Promise((resolve) => {
    const id = ++seq;
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.removeEventListener("message", onMsg);
      resolve(value);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as Record<string, unknown> | null;
      if (d && d.id === id) finish(read(d));
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    w.addEventListener("message", onMsg);
    w.postMessage({ id, ...payload });
  });
}

/** The eval bar can only ever want the CURRENT position, so a slow answer is a
 * worthless one — give up quickly and leave the bar where it is. */
const EVAL_TIMEOUT_MS = 1500;

/** Advice is prefetched while the student is still looking at the board, and
 * nothing is blocked on it, so it gets the same patience as the bot's own move.
 * Giving up early would buy nothing and cost a lot: the map is never re-asked
 * for a position, so a premature null means every move from it pays the
 * synchronous fallback instead. */
const ADVICE_TIMEOUT_MS = 5000;

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

/**
 * Classify every legal move of `fen` for the coach. Resolves `null` if the
 * worker is unavailable or too slow — the caller must be able to live without
 * it (app/solo/page.tsx re-derives the one move it actually needs).
 */
export function requestAdvice(fen: string, depth?: number): Promise<AdviceMap | null> {
  return ask<AdviceMap>(
    { mode: "advice", fen, depth },
    (d) => (d.advice as AdviceMap | null) ?? null,
    ADVICE_TIMEOUT_MS,
  );
}

/**
 * Evaluate `fen` for the eval bar / hype callout. Resolves `null` if the worker
 * is unavailable or slow. There is deliberately NO synchronous fallback: this
 * runs on every spectated move on a projector, and a blocked main thread is a
 * visibly stuttering board.
 */
export function requestEval(fen: string, depth?: number): Promise<Evaluation | null> {
  return ask<Evaluation>(
    { mode: "eval", fen, depth },
    (d) => (d.evaluation as Evaluation | null) ?? null,
    EVAL_TIMEOUT_MS,
  );
}
