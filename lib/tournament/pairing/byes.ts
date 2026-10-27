import type { ByeType, HistoryGame, PairingPlayer } from "./types";

/** Count byes of every kind per player. */
export function byeCountsFromHistory(history: readonly HistoryGame[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of history) if (g.black === null) out.set(g.white, (out.get(g.white) ?? 0) + 1);
  return out;
}

/** Active players, split into those with a requested bye (not paired) and the pool. */
export function splitRequestedByes<T extends PairingPlayer>(
  players: readonly T[],
): { requested: { id: string; byeType: ByeType }[]; pool: T[] } {
  const requested: { id: string; byeType: ByeType }[] = [];
  const pool: T[] = [];
  for (const p of players) {
    if (p.status !== "active") continue;
    if (p.byeRequest) requested.push({ id: p.id, byeType: p.byeRequest });
    else pool.push(p);
  }
  return { requested, pool };
}

/**
 * Candidates for the automatic bye in preference order: fewest byes so far, then
 * lowest-ranked. `ranked` is best-first. Only the fewest-byes tier is returned,
 * so a second bye is never given while someone with fewer remains.
 */
export function byeCandidates(
  ranked: readonly { id: string }[],
  byeCounts: ReadonlyMap<string, number>,
): string[] {
  let min = Infinity;
  for (const p of ranked) min = Math.min(min, byeCounts.get(p.id) ?? 0);
  const out: string[] = [];
  for (let i = ranked.length - 1; i >= 0; i--) {
    if ((byeCounts.get(ranked[i].id) ?? 0) === min) out.push(ranked[i].id);
  }
  return out;
}
