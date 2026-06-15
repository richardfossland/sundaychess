// Single pre-move support for blitz / online multiplayer: a player queues one
// move while it's the opponent's turn, and it fires the instant their own turn
// arrives. This is the PURE resolver — given the position that just became the
// mover's to play and the queued (from,to), return the concrete move if it's
// legal now, or null to discard it (the opponent's move made it illegal).

import { Chess } from "chess.js";
import type { MoveIntent } from "@/lib/chess/validateMove";

export interface QueuedMove {
  from: string;
  to: string;
}

/** Resolve a queued pre-move against `fen` (the position now on the mover's
 * clock). Returns the move (auto-queening, matching the board's commit) if it
 * is legal, else null. Pure + deterministic. */
export function resolvePremove(fen: string, pre: QueuedMove): MoveIntent | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const legal = chess.moves({ verbose: true }) as unknown as {
    from: string;
    to: string;
  }[];
  const ok = legal.some((m) => m.from === pre.from && m.to === pre.to);
  return ok ? { from: pre.from, to: pre.to, promotion: "q" } : null;
}

/** The colour of the piece on `square` in `fen`, or null if empty/unparseable.
 * Used to let a player pre-select only their OWN pieces while it isn't their
 * turn (chess.js can't generate moves for the side not to move). */
export function pieceColorAt(fen: string, square: string): "w" | "b" | null {
  try {
    const p = new Chess(fen).get(square as Parameters<Chess["get"]>[0]);
    return p ? p.color : null;
  } catch {
    return null;
  }
}
