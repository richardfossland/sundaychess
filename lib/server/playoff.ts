import "server-only";

import type { Tournament } from "@/lib/types";

// Playoff engine. Implemented in Phase 5; the league module calls
// maybeStartPlayoff() when the league rounds are exhausted.
//
// Returns true if a playoff bracket was started, false to fall through to
// "finished".
export async function maybeStartPlayoff(
  _tournament: Tournament,
): Promise<boolean> {
  // Phase 5 fills this in (seed top N, build single-elim bracket).
  return false;
}

/** Are all games in the current playoff round resolved? (Phase 5) */
export async function playoffRoundResolved(
  _tournament: Tournament,
): Promise<boolean> {
  return true;
}

/** Advance the playoff bracket one round, or finish. (Phase 5) */
export async function advancePlayoff(
  _tournament: Tournament,
): Promise<"playoff" | "finished"> {
  return "finished";
}
