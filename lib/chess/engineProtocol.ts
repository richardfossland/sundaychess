// The message contract between lib/client/engine.ts (main thread) and
// lib/chess/engine.worker.ts (worker thread), plus the pure dispatcher that
// answers one request.
//
// It lives outside the worker file so it can be imported and unit-tested in
// plain node — the worker itself is then a three-line shim around it, with no
// logic that only runs where tests cannot reach.
//
// Every request carries an `id`; every response echoes it. The client
// sequence-numbers requests and ignores replies whose id it is no longer
// waiting for, so a slow answer can never overwrite a newer one.

import { bestMove, bestMoveBySkill, bestMoveStrong, evaluateFen, type BotLevel } from "@/lib/chess/bot";
import { adviceMap, type AdviceMap } from "@/lib/chess/coach";
import type { Evaluation } from "@/lib/chess/evalBar";
import type { MoveIntent } from "@/lib/chess/validateMove";

/** A request without its id — what callers build; `id` is stamped on at post
 * time. Kept separate because `Omit` over a discriminated union would flatten
 * the mode-specific fields away. */
export type EngineRequestBody = { fen: string } & (
  // The bot's own move — the original two modes, unchanged.
  | { mode: "skill"; skill: number }
  | { mode: "level"; level: BotLevel }
  // Coach: classify every legal move of `fen` in one pass.
  | { mode: "advice"; depth?: number }
  // Spectator eval bar / hype callout.
  | { mode: "eval"; depth?: number }
);

export type EngineRequest = EngineRequestBody & { id: number };

export type EngineResponse =
  | { id: number; move: MoveIntent | null }
  | { id: number; advice: AdviceMap | null }
  | { id: number; evaluation: Evaluation | null };

/**
 * Answer one engine request. Never throws: a bad FEN or an internal failure
 * comes back as a null payload, which every caller already treats as "no
 * answer" (the client then falls back or shows a neutral bar).
 */
export async function handleEngineRequest(req: EngineRequest): Promise<EngineResponse> {
  const { id } = req;
  try {
    switch (req.mode) {
      case "advice":
        return { id, advice: adviceMap(req.fen, req.depth) };
      case "eval":
        return { id, evaluation: evaluateFen(req.fen, req.depth) };
      case "skill":
        return { id, move: bestMoveBySkill(req.fen, req.skill) };
      default:
        return {
          id,
          move:
            req.level === "impossible"
              ? await bestMoveStrong(req.fen)
              : bestMove(req.fen, req.level),
        };
    }
  } catch {
    // Shape the failure like the request so the waiting caller resolves instead
    // of hanging until its timeout.
    if (req.mode === "advice") return { id, advice: null };
    if (req.mode === "eval") return { id, evaluation: null };
    return { id, move: null };
  }
}
