// Swiss / Monrad pairing — pure function with injectable RNG.
//
// Pragmatic greedy Monrad (not FIDE-perfect, by design — spec §6):
//  - Round 1: shuffle, pair sequentially, odd one out gets a bye.
//  - Round ≥2: sort by (score desc, tiebreak desc); greedily pair adjacent
//    players who have NOT met before, floating a player down when a score
//    group is odd; bye goes to the lowest-ranked player without one yet.
//  - Colours are balanced (fewer-whites-so-far plays white; ties → higher rank).

import type { Rng } from "@/lib/codes";

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
  /** Player ids who already received a bye. */
  hadBye?: ReadonlySet<string>;
  /** Per-player colour history for balancing white/black. */
  colors?: ReadonlyMap<string, ColorCount>;
  rng?: Rng;
}

export interface Pairing {
  whiteId: string;
  blackId: string | null; // null = bye
  /** True when this pair has met before (only set when a rematch was forced). */
  rematch?: boolean;
}

/** Stable unordered key for a pair of player ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function byStandings(a: PairablePlayer, b: PairablePlayer): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.tiebreak !== a.tiebreak) return b.tiebreak - a.tiebreak;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // deterministic
}

/** Decide which of two players takes white, balancing colour history. */
function assignColors(
  hi: string,
  lo: string,
  colors: ReadonlyMap<string, ColorCount> | undefined,
): { whiteId: string; blackId: string } {
  if (colors) {
    const hiW = colors.get(hi)?.white ?? 0;
    const loW = colors.get(lo)?.white ?? 0;
    if (hiW > loW) return { whiteId: lo, blackId: hi };
    if (loW > hiW) return { whiteId: hi, blackId: lo };
  }
  // Default: higher-ranked (passed as `hi`) takes white.
  return { whiteId: hi, blackId: lo };
}

export function pair(input: PairInput): Pairing[] {
  const rng = input.rng ?? Math.random;
  const metBefore = input.metBefore ?? new Set<string>();
  const hadBye = input.hadBye ?? new Set<string>();
  const colors = input.colors;

  if (input.players.length === 0) return [];

  // Order the pool: random for round 1, standings otherwise.
  const pool =
    input.round <= 1
      ? shuffle(input.players, rng)
      : input.players.slice().sort(byStandings);

  const pairings: Pairing[] = [];
  let byeId: string | null = null;

  if (pool.length % 2 === 1) {
    if (input.round <= 1) {
      // Round 1: the last shuffled player gets the bye.
      byeId = pool[pool.length - 1].id;
    } else {
      // Lowest-ranked player who has not had a bye; fall back to lowest overall.
      for (let i = pool.length - 1; i >= 0; i--) {
        if (!hadBye.has(pool[i].id)) {
          byeId = pool[i].id;
          break;
        }
      }
      if (byeId === null) byeId = pool[pool.length - 1].id;
    }
  }

  const queue = pool.filter((p) => p.id !== byeId);
  const used = new Set<string>();

  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (used.has(a.id)) continue;
    used.add(a.id);

    // Prefer the nearest-ranked opponent not yet met.
    let opponent: PairablePlayer | null = null;
    let forcedRematch = false;
    for (let j = i + 1; j < queue.length; j++) {
      const b = queue[j];
      if (used.has(b.id)) continue;
      if (!metBefore.has(pairKey(a.id, b.id))) {
        opponent = b;
        break;
      }
    }
    // No fresh opponent available → allow the nearest rematch.
    if (!opponent) {
      for (let j = i + 1; j < queue.length; j++) {
        const b = queue[j];
        if (used.has(b.id)) continue;
        opponent = b;
        forcedRematch = true;
        break;
      }
    }

    if (opponent) {
      used.add(opponent.id);
      const { whiteId, blackId } = assignColors(a.id, opponent.id, colors);
      pairings.push(
        forcedRematch ? { whiteId, blackId, rematch: true } : { whiteId, blackId },
      );
    }
  }

  if (byeId !== null) pairings.push({ whiteId: byeId, blackId: null });
  return pairings;
}
