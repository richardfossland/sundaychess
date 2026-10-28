// Round robin (alle mot alle) with FIDE Berger tables (Handbook C.05 Annex 1).
//
// Pairing numbers 1..n follow `startNo` order (ties → id). Odd n gets a dummy
// player n+1: whoever draws the dummy has the bye that round.
//
// Table rule (m = N-1 for N even/padded; verified against the published tables
// for N = 4..10 in test/pairing/roundRobin.test.ts):
//   round r pairs a≠b ≤ m when a+b ≡ r+1 (mod m); the player x with 2x ≡ r+1
//   plays N. N has white in even rounds, black in odd rounds.
//   With s = r+1: a+b = s ("not wrapped") or s+m ("wrapped"). Odd round: wrapped →
//   lower number white, not wrapped → higher white. Even round: reversed.
//
// Double round robin: second cycle repeats the first with colours reversed. As FIDE
// recommends, the last two rounds of the FIRST cycle are swapped (option
// `swapLastTwo`, default true) to avoid three games in a row with the same colour.
//
// The dummy's "bye" is a FREE ROUND (fri runde), not a win: it scores 0 and is
// emitted with byeType "zero" (unless the player requested a bye type). Only a
// game forfeited by an inactive opponent gives the active player a "full" bye.
//
// CALLERS MUST PASS ALL REGISTERED PLAYERS, withdrawn ones included, on every
// call: the table (pairing numbers, dummy slot) is derived from the whole list, so
// dropping a withdrawn player renumbers everyone and moves every later round.
// pairRoundRobin throws if `history` mentions a player that is missing from
// `players`, and on duplicate ids.
//
// Withdrawn / absent players (documented rule): the table is fixed from ALL players
// in the input, so nobody's schedule moves. A game against an inactive player is
// not played: an active opponent gets a "full" bye (a forfeit win, 1 pt); if both
// are inactive nothing is emitted. A player with `byeRequest` gets that bye and
// the opponent a forfeit win ("full" bye), same as withdrawn.

import { splitRequestedByes } from "./byes";
import type { BoardPairing, PairingInput, PairingOutput, PairingPlayer } from "./types";

export interface RRGame {
  /** Pairing numbers (1-based); `white`/`black` may be the dummy (n+1 for odd n). */
  white: number;
  black: number;
}

export interface RRTable {
  /** Table size N (even; = n, or n+1 for odd n). */
  size: number;
  /** rounds[r-1] = games in board order (the N board first). */
  rounds: RRGame[][];
}

/** FIDE Berger table for N (even) players, single cycle. */
export function bergerTable(size: number): RRGame[][] {
  if (size < 2 || size % 2 !== 0) throw new Error("bergerTable: size must be even and ≥ 2");
  const N = size;
  const m = N - 1;
  const rounds: RRGame[][] = [];
  const wrap = (v: number) => ((((v - 1) % m) + m) % m) + 1; // into 1..m
  for (let r = 1; r <= m; r++) {
    const s = r + 1;
    // x with 2x ≡ s (mod m)
    let x = 0;
    for (let c = 1; c <= m; c++) if ((2 * c - s) % m === 0) { x = c; break; }
    const games: RRGame[] = [];
    games.push(r % 2 === 0 ? { white: N, black: x } : { white: x, black: N });
    const done = new Set<number>([x]);
    for (let k = 1; k < m; k++) {
      const a = wrap(x + k);
      if (done.has(a)) continue;
      const b = wrap(s - a);
      done.add(a);
      done.add(b);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const wrapped = a + b !== s;
      const loWhite = r % 2 === 1 ? wrapped : !wrapped;
      games.push(loWhite ? { white: lo, black: hi } : { white: hi, black: lo });
    }
    rounds.push(games);
  }
  return rounds;
}

export interface RoundRobinOptions {
  double?: boolean;
  /** Double RR only: swap last two rounds of the first cycle (FIDE recommendation). Default true. */
  swapLastTwo?: boolean;
}

/** Players in pairing-number order. */
export function tableOrder<T extends PairingPlayer>(players: readonly T[]): T[] {
  return players
    .slice()
    .sort((a, b) => a.startNo - b.startNo || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface ScheduledGame {
  white: string;
  /** null = bye for `white`. */
  black: string | null;
}

export interface RoundRobinSchedule {
  /** rounds[r-1] = board order, byes last. */
  rounds: ScheduledGame[][];
}

/** All rounds for the given players (any status — the schedule is static). */
export function roundRobinSchedule(
  players: readonly PairingPlayer[],
  opts: RoundRobinOptions = {},
): RoundRobinSchedule {
  const order = tableOrder(players);
  const n = order.length;
  if (n < 2) return { rounds: [] };
  const size = n % 2 === 0 ? n : n + 1;
  const base = bergerTable(size);
  const cycle1 = base.slice();
  if (opts.double && (opts.swapLastTwo ?? true) && cycle1.length >= 3) {
    const k = cycle1.length;
    [cycle1[k - 2], cycle1[k - 1]] = [cycle1[k - 1], cycle1[k - 2]];
  }
  const cycle2 = cycle1.map((g) => g.map((x) => ({ white: x.black, black: x.white })));
  const all = opts.double ? [...cycle1, ...cycle2] : cycle1;
  const id = (num: number) => order[num - 1].id;
  const rounds = all.map((games) => {
    const real: ScheduledGame[] = [];
    const byes: ScheduledGame[] = [];
    for (const g of games) {
      if (g.white > n) byes.push({ white: id(g.black), black: null });
      else if (g.black > n) byes.push({ white: id(g.white), black: null });
      else real.push({ white: id(g.white), black: id(g.black) });
    }
    return [...real, ...byes];
  });
  return { rounds };
}

/** Number of rounds for n players. */
export function roundRobinRounds(n: number, double = false): number {
  if (n < 2) return 0;
  const single = n % 2 === 0 ? n - 1 : n;
  return double ? single * 2 : single;
}

/** Shared-interface entry: round `input.round` from the table. See file header for withdrawals. */
export function pairRoundRobin(input: PairingInput, opts: RoundRobinOptions = {}): PairingOutput {
  const known = new Set(input.players.map((p) => p.id));
  if (known.size !== input.players.length) throw new Error("pairRoundRobin: duplicate player id");
  for (const g of input.history) {
    if (!known.has(g.white) || (g.black !== null && !known.has(g.black))) {
      throw new Error(
        "pairRoundRobin: history mentions a player missing from `players` — pass ALL registered players (incl. withdrawn) or the table shifts",
      );
    }
  }
  const sched = roundRobinSchedule(input.players, opts);
  const games = sched.rounds[input.round - 1];
  if (!games) return { pairings: [] };
  const byId = new Map(input.players.map((p) => [p.id, p]));
  const { requested } = splitRequestedByes(input.players);
  const reqMap = new Map(requested.map((r) => [r.id, r.byeType]));
  const active = (id: string) => byId.get(id)?.status === "active";

  const real: BoardPairing[] = [];
  const byes: Omit<BoardPairing, "board">[] = [];
  for (const g of games) {
    if (g.black === null) {
      // Table bye (odd n): the dummy opponent. A free round — scores 0.
      if (!active(g.white)) continue;
      const req = reqMap.get(g.white);
      byes.push({ white: g.white, black: null, byeType: req ?? "zero" });
      continue;
    }
    const wa = active(g.white);
    const ba = active(g.black);
    const wReq = reqMap.get(g.white);
    const bReq = reqMap.get(g.black);
    if (wa && ba && !wReq && !bReq) {
      real.push({ board: 0, white: g.white, black: g.black });
      continue;
    }
    // Game not played: each active player gets a bye (requested, else forfeit win).
    if (wa) byes.push({ white: g.white, black: null, byeType: wReq ?? "full" });
    if (ba) byes.push({ white: g.black, black: null, byeType: bReq ?? "full" });
  }
  const pairings: BoardPairing[] = [...real, ...byes.map((b) => ({ ...b, board: 0 }))];
  pairings.forEach((p, i) => (p.board = i + 1));
  return { pairings };
}
