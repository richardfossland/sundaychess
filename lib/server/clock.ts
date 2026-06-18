import "server-only";

import { getRound, getTournament, listMoveStamps } from "@/lib/server/store";
import { computeClocks, type ClockSnapshot } from "@/lib/chess/clock";
import type { Game, Turn } from "@/lib/types";

/** Wire shape sent to clients (they tick it down locally from receipt). */
export interface ClockInfo {
  whiteMs: number;
  blackMs: number;
  turn: Turn;
  running: boolean;
}

/** Authoritative clock snapshot for a game, or null when the tournament has
 * no chess clock configured (or the round hasn't started). */
export async function gameClock(
  game: Game,
): Promise<{ snap: ClockSnapshot; info: ClockInfo } | null> {
  const t = await getTournament(game.tournament_id);
  const clockSec = t?.config.clockSec ?? null;
  if (!clockSec) return null;

  // round + move stamps in parallel — saves a serial DB round-trip on the hot
  // move path for clock (lyn/blitz) games.
  const [round, moves] = await Promise.all([
    getRound(game.round_id),
    listMoveStamps(game.id),
  ]);
  if (!round?.started_at) return null;
  const running = game.status === "live";
  const snap = computeClocks({
    clockSec,
    startedAt: round.started_at,
    moves,
    turn: game.turn,
    now: new Date(),
    running,
  });
  return {
    snap,
    info: {
      whiteMs: snap.whiteMs,
      blackMs: snap.blackMs,
      turn: game.turn,
      running,
    },
  };
}
