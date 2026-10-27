// Monrad pairing per Norwegian practice: order by score group, then start number;
// pair the first unpaired player with the nearest legal opponent below
// (1–2, 3–4 …), searching/backtracking downward — i.e. floating down to the next
// score group — when blocked by a repeat or an impossible colour combination.
// Relaxation order when no perfect matching exists:
//   1. no repeat AND colours satisfiable   2. no repeat   3. forced rematch (flagged).

import { byeCandidates, byeCountsFromHistory, splitRequestedByes } from "./byes";
import { allocateColours, colourConflict, colourStatesFromHistory, NO_COLOURS } from "./colors";
import type {
  BoardPairing,
  ColourState,
  PairingContext,
  PairingInput,
  PairingOutput,
  PairingPlayer,
} from "./types";

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function contextFromHistory(history: PairingInput["history"]): PairingContext {
  const met = new Set<string>();
  for (const g of history) if (g.black !== null) met.add(pairKey(g.white, g.black));
  return { met, byeCounts: byeCountsFromHistory(history), colours: colourStatesFromHistory(history) };
}

/** Best-first: score desc, tiebreak desc, start number asc, id (deterministic). */
export function rankPlayers<T extends PairingPlayer>(players: readonly T[]): T[] {
  return players.slice().sort(
    (a, b) =>
      b.score - a.score ||
      (b.tiebreak ?? 0) - (a.tiebreak ?? 0) ||
      a.startNo - b.startNo ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

interface Match {
  hi: string;
  lo: string;
  rematch?: boolean;
}

const NODE_BUDGET = 200_000;

/** Backtracking perfect matching, nearest-first. null when none (or budget spent). */
function solve(
  queue: readonly string[],
  ok: (a: string, b: string) => boolean,
): Match[] | null {
  const used = new Array<boolean>(queue.length).fill(false);
  const out: Match[] = [];
  let nodes = 0;
  const rec = (): boolean => {
    let i = 0;
    while (i < queue.length && used[i]) i++;
    if (i === queue.length) return true;
    used[i] = true;
    for (let j = i + 1; j < queue.length; j++) {
      if (used[j] || !ok(queue[i], queue[j])) continue;
      if (++nodes > NODE_BUDGET) break;
      used[j] = true;
      out.push({ hi: queue[i], lo: queue[j] });
      if (rec()) return true;
      out.pop();
      used[j] = false;
    }
    used[i] = false;
    return false;
  };
  return rec() ? out.slice() : null;
}

/** Last resort: greedy, repeats allowed and flagged. */
function greedy(queue: readonly string[], met: ReadonlySet<string>): Match[] {
  const used = new Set<string>();
  const out: Match[] = [];
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (used.has(a)) continue;
    used.add(a);
    let opp: string | null = null;
    let rematch = false;
    for (let j = i + 1; j < queue.length && !opp; j++) {
      if (!used.has(queue[j]) && !met.has(pairKey(a, queue[j]))) opp = queue[j];
    }
    if (!opp) {
      for (let j = i + 1; j < queue.length && !opp; j++) {
        if (!used.has(queue[j])) {
          opp = queue[j];
          rematch = true;
        }
      }
    }
    if (opp) {
      used.add(opp);
      out.push(rematch ? { hi: a, lo: opp, rematch } : { hi: a, lo: opp });
    }
  }
  return out;
}

function matchQueue(queue: readonly string[], ctx: PairingContext): Match[] | null {
  const cs = (id: string): ColourState => ctx.colours.get(id) ?? NO_COLOURS;
  const fresh = (a: string, b: string) => !ctx.met.has(pairKey(a, b));
  return (
    solve(queue, (a, b) => fresh(a, b) && !colourConflict(cs(a), cs(b))) ??
    solve(queue, fresh)
  );
}

/**
 * Pair an already-ranked-agnostic pool with a prepared context. The core used by
 * both `monrad()` and the legacy `pair()` adapter.
 */
export function monradWithContext(
  players: readonly PairingPlayer[],
  ctx: PairingContext,
): PairingOutput {
  const { requested, pool } = splitRequestedByes(players);
  const ranked = rankPlayers(pool);
  const rankIds = ranked.map((p) => p.id);

  let queue = rankIds;
  let matches: Match[] | null = null;
  let autoBye: string | null = null;

  if (rankIds.length % 2 === 0) {
    matches = matchQueue(queue, ctx);
  } else {
    const cands = byeCandidates(ranked, ctx.byeCounts);
    for (const c of cands) {
      const q = rankIds.filter((id) => id !== c);
      const m = matchQueue(q, ctx);
      if (m) {
        autoBye = c;
        queue = q;
        matches = m;
        break;
      }
    }
    if (autoBye === null && cands.length > 0) {
      autoBye = cands[0];
      queue = rankIds.filter((id) => id !== autoBye);
    }
  }
  matches ??= greedy(queue, ctx.met);

  const pairings: BoardPairing[] = [];
  let board = 1;
  for (const m of matches) {
    const { white, black } = allocateColours(m.hi, m.lo, ctx.colours.get(m.hi), ctx.colours.get(m.lo));
    pairings.push(m.rematch ? { board: board++, white, black, rematch: true } : { board: board++, white, black });
  }
  if (autoBye !== null) pairings.push({ board: board++, white: autoBye, black: null, byeType: "full" });
  for (const r of requested) pairings.push({ board: board++, white: r.id, black: null, byeType: r.byeType });
  return { pairings };
}

export function monrad(input: PairingInput): PairingOutput {
  return monradWithContext(input.players, contextFromHistory(input.history));
}
