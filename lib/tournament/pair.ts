// Legacy adapter: league.ts calls pair(); the real work lives in
// lib/tournament/pairing/monrad.ts (Monrad per NSF rules, shared colour + bye layer).
//
// Differences from the old greedy implementation (see PR): colours now also
// influence which opponent is chosen, a bye candidate is skipped if that would
// force a repeat pairing, and colour preference uses white−black balance.
// "Never 3 of the same colour in a row" only applies when the caller passes the
// real game `history` (colour SEQUENCES with round numbers): the bare `colors`
// counts carry no order, so they can only balance white−black (|diff| ≤ 2),
// never detect a run. The league (lib/server/league.ts) passes `history`.
// Round 1 still shuffles with the injected RNG, so seeded behaviour is unchanged.

import type { Rng } from "@/lib/codes";
import { colourStateFromCounts, colourStatesFromHistory } from "@/lib/tournament/pairing/colors";
import { monradWithContext, pairKey } from "@/lib/tournament/pairing/monrad";
import type { ColourState, HistoryGame, PairingPlayer } from "@/lib/tournament/pairing/types";

export { pairKey };

export interface PairablePlayer {
  id: string;
  score: number;
  tiebreak: number;
}

export interface ColorCount {
  white: number;
  black: number;
}

export interface PairInput {
  players: PairablePlayer[];
  round: number;
  /** Unordered keys of pairs that already played — see pairKey(). */
  metBefore?: ReadonlySet<string>;
  /** Player ids who already received a bye (legacy; superseded by byeCounts). */
  hadBye?: ReadonlySet<string>;
  /** Per-player bye counts — preferred over hadBye, for even distribution. */
  byeCounts?: ReadonlyMap<string, number>;
  /** Per-player colour COUNTS for balancing white/black. No order, so no run
   * detection — prefer `history`. */
  colors?: ReadonlyMap<string, ColorCount>;
  /** Real game history (round numbers, forfeit flag). When given, colour state
   * (balance AND same-colour runs) is derived from it and overrides `colors`
   * for every player who has played; forfeits carry no colour. */
  history?: readonly HistoryGame[];
  rng?: Rng;
}

export interface Pairing {
  whiteId: string;
  blackId: string | null; // null = bye
  /** True when this pair has met before (only set when a rematch was forced). */
  rematch?: boolean;
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pair(input: PairInput): Pairing[] {
  const rng = input.rng ?? Math.random;
  if (input.players.length === 0) return [];
  const round1 = input.round <= 1;

  // Round 1: random order (scores ignored) → start numbers by shuffled position.
  // Later: standings order; start number = id order, the old final tie-break.
  const ordered = round1
    ? shuffle(input.players, rng)
    : input.players.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const players: PairingPlayer[] = ordered.map((p, i) => ({
    id: p.id,
    startNo: i + 1,
    score: round1 ? 0 : p.score,
    tiebreak: round1 ? 0 : p.tiebreak,
    status: "active",
  }));

  const byeCounts: ReadonlyMap<string, number> =
    input.byeCounts ?? new Map([...(input.hadBye ?? [])].map((id) => [id, 1]));
  const colours = new Map<string, ColourState>();
  for (const [id, c] of input.colors ?? []) colours.set(id, colourStateFromCounts(c.white, c.black));
  if (input.history) for (const [id, s] of colourStatesFromHistory(input.history)) colours.set(id, s);

  const { pairings } = monradWithContext(players, {
    met: input.metBefore ?? new Set<string>(),
    byeCounts,
    colours,
  });
  return pairings.map((p) =>
    p.rematch ? { whiteId: p.white, blackId: p.black, rematch: true } : { whiteId: p.white, blackId: p.black },
  );
}
