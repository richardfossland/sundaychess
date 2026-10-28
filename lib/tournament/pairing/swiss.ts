// Swiss pairing, "FIDE-inspirert" — NOT the FIDE Dutch system (no bbpPairings, no
// exact C.04 criteria). Ported from sundayturnering's swiss.ts (MIT, see
// THIRD-PARTY-NOTICES.md) and extended with colour and float logic.
//
// Round 1: rating seeding — players sorted by rating (fallback startNo), top half
// against bottom half (1–5, 2–6 …); colours alternate by board.
//
// Later rounds: maximum-weight matching (Edmonds' blossom, lib/vendor). Every pair
// is an edge with weight BASE − penalty; the penalties, in priority order:
//   rematch (huge)  >  colour conflict (both forced the same colour)  >  bye to
//   someone who already had one / not in the fewest-byes tier  >  bye to a high
//   ranked player  >  score distance² (equal scores strongly preferred, so a
//   downfloat only happens when forced)  >  repeat float  >  soft colour clash
//   >  rank distance (tie-break: neighbours first).
// Odd pool: a dummy node is the bye, connected only to byeCandidates() (shared
// bye layer), so the bye never forces an avoidable rematch. Rematches stay legal
// (flagged) only when no matching without one exists. Colours via allocateColours.
// Deterministic: no randomness; ties resolve by ranking order.

import blossom from "@/lib/vendor/edmonds-blossom";
import { byeCandidates, splitRequestedByes } from "./byes";
import { allocateColours, colourConflict, NO_COLOURS, preferredColour } from "./colors";
import { contextFromHistory, pairKey, rankPlayers } from "./monrad";
import type {
  BoardPairing,
  GameResult,
  HistoryGame,
  PairingContext,
  PairingInput,
  PairingOutput,
  PairingPlayer,
} from "./types";

const BASE = 1e13;
const REMATCH = 1e12;
const COLOUR_CONFLICT = 1e11;
const REPEAT_BYE = 1e10;
const BYE_RANK = 1e7; // per place above the bottom
const SCORE_UNIT = 1e7; // × (score difference)²
const REPEAT_FLOAT = 1e6; // per player who also floated last round
const SOFT_COLOUR = 1e5; // × weaker strength of two equal colour wishes

/** Round 1 order: rating desc (unrated last), then startNo, then id. */
export function seedOrder<T extends PairingPlayer>(players: readonly T[]): T[] {
  return players.slice().sort(
    (a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) ||
      a.startNo - b.startNo ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

const PTS: Record<GameResult, [number, number]> = {
  "1-0": [1, 0],
  "0-1": [0, 1],
  "1/2-1/2": [0.5, 0.5],
  "0-0": [0, 0],
  bye: [1, 0],
};

function pointsBefore(history: readonly HistoryGame[], round: number): Map<string, number> {
  const s = new Map<string, number>();
  for (const g of history) {
    if (g.round >= round) continue;
    const [w, b] = PTS[g.result];
    const wp = g.black === null ? (g.byeType === "half" ? 0.5 : g.byeType === "zero" ? 0 : 1) : w;
    s.set(g.white, (s.get(g.white) ?? 0) + wp);
    if (g.black !== null) s.set(g.black, (s.get(g.black) ?? 0) + b);
  }
  return s;
}

/** Players who floated (played someone with a different score) in `round`. */
function floatersIn(history: readonly HistoryGame[], round: number): Set<string> {
  const before = pointsBefore(history, round);
  const out = new Set<string>();
  for (const g of history) {
    if (g.round !== round || g.black === null) continue;
    if ((before.get(g.white) ?? 0) !== (before.get(g.black) ?? 0)) {
      out.add(g.white);
      out.add(g.black);
    }
  }
  return out;
}

interface Match {
  hi: string;
  lo: string;
}

function pairFirstRound(pool: readonly PairingPlayer[], ctx: PairingContext): { matches: Match[]; bye: string | null } {
  const seeded = seedOrder(pool);
  let bye: string | null = null;
  let ids = seeded.map((p) => p.id);
  if (ids.length % 2 === 1) {
    bye = byeCandidates(seeded, ctx.byeCounts)[0];
    ids = ids.filter((i) => i !== bye);
  }
  const half = ids.length / 2;
  const matches: Match[] = [];
  for (let i = 0; i < half; i++) matches.push({ hi: ids[i], lo: ids[i + half] });
  return { matches, bye };
}

function pairLater(
  pool: readonly PairingPlayer[],
  ctx: PairingContext,
  history: PairingInput["history"],
  round: number,
): { matches: Match[]; bye: string | null } {
  const ranked = rankPlayers(pool);
  const n = ranked.length;
  const odd = n % 2 === 1;
  const floated = floatersIn(history, round - 1);
  const cs = (id: string) => ctx.colours.get(id) ?? NO_COLOURS;
  const byeOk = odd ? new Set(byeCandidates(ranked, ctx.byeCounts)) : new Set<string>();

  const edges: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ranked[i];
    for (let j = i + 1; j < n; j++) {
      const b = ranked[j];
      const d = Math.abs(a.score - b.score);
      let pen = Math.round(d * d * SCORE_UNIT) + (j - i);
      if (d > 0) {
        if (floated.has(a.id)) pen += REPEAT_FLOAT;
        if (floated.has(b.id)) pen += REPEAT_FLOAT;
      }
      if (ctx.met.has(pairKey(a.id, b.id))) pen += REMATCH;
      if (colourConflict(cs(a.id), cs(b.id))) pen += COLOUR_CONFLICT;
      else {
        const pa = preferredColour(cs(a.id));
        const pb = preferredColour(cs(b.id));
        if (pa.colour && pa.colour === pb.colour) pen += Math.round(SOFT_COLOUR * Math.min(pa.strength, pb.strength));
      }
      edges.push([i, j, BASE - pen]);
    }
    if (odd && byeOk.has(a.id)) {
      let pen = (n - 1 - i) * BYE_RANK;
      if ((ctx.byeCounts.get(a.id) ?? 0) > 0) pen += REPEAT_BYE;
      edges.push([i, n, BASE - pen]);
    }
  }

  const mate: number[] = n >= 2 ? blossom(edges, true) : [];
  const matches: Match[] = [];
  let bye: string | null = null;
  const done = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (done.has(i)) continue;
    const j = mate[i];
    done.add(i);
    if (j === undefined || j < 0 || j === n) {
      bye = ranked[i].id;
      continue;
    }
    done.add(j);
    matches.push({ hi: ranked[i].id, lo: ranked[j].id });
  }
  return { matches, bye };
}

export function swiss(input: PairingInput): PairingOutput {
  const ctx = contextFromHistory(input.history);
  const { requested, pool } = splitRequestedByes(input.players);
  const first = input.history.length === 0;
  const { matches, bye } = first ? pairFirstRound(pool, ctx) : pairLater(pool, ctx, input.history, input.round);

  const pairings: BoardPairing[] = [];
  let board = 1;
  for (const [k, m] of matches.entries()) {
    let { white, black } = allocateColours(m.hi, m.lo, ctx.colours.get(m.hi), ctx.colours.get(m.lo));
    // Round 1 has no colour history: alternate the top seed's colour board by board.
    if (first && k % 2 === 1) [white, black] = [black, white];
    const p: BoardPairing = { board: board++, white, black };
    if (ctx.met.has(pairKey(m.hi, m.lo))) p.rematch = true;
    pairings.push(p);
  }
  if (bye !== null) pairings.push({ board: board++, white: bye, black: null, byeType: "full" });
  for (const r of requested) pairings.push({ board: board++, white: r.id, black: null, byeType: r.byeType });
  return { pairings };
}
