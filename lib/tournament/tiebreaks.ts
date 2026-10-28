// Konfigurerbare tiebreaks for sveitsisk/alle-mot-alle. Rene funksjoner over
// historikken fra pairing/types.ts. Bygger på FIDE C.07 (Tie-Break Regulations):
//  - ubrukte runder (bye, fravær, forfeit) får «virtuell motstander» (art. 16.4):
//    poengsum = min(egen sluttsum, ½ × antall runder); forfeit teller mot den
//    oppsatte motstanderens sum.
//  - innbyrdes oppgjør er en rekursiv minitabell blant likestilte (art. 6).
// Mønsteret (konfigurerbar rekkefølge + rekursiv minitabell) er portet fra
// sundayturnering/lib/tournament/standings.ts.

import type { ByeType, GameResult, HistoryGame } from "@/lib/tournament/pairing/types";

export type TiebreakKey =
  | "buchholz"
  | "buchholz_cut1"
  | "buchholz_median"
  | "sonneborn_berger"
  | "direct_encounter"
  | "wins"
  | "progressive"
  | "avg_opponent_rating";

export const TIEBREAK_KEYS: readonly TiebreakKey[] = [
  "buchholz",
  "buchholz_cut1",
  "buchholz_median",
  "sonneborn_berger",
  "direct_encounter",
  "wins",
  "progressive",
  "avg_opponent_rating",
];

/** Standard i dag: bare Buchholz. */
export const DEFAULT_TIEBREAKS: readonly TiebreakKey[] = ["buchholz"];

/** Validerer ukjent (jsonb) input til en rekkefølge; ukjent/tomt → standard. */
export function resolveTiebreaks(raw: unknown): TiebreakKey[] {
  if (!Array.isArray(raw)) return [...DEFAULT_TIEBREAKS];
  const out: TiebreakKey[] = [];
  for (const k of raw) {
    if (TIEBREAK_KEYS.includes(k as TiebreakKey) && !out.includes(k as TiebreakKey)) {
      out.push(k as TiebreakKey);
    }
  }
  return out.length ? out : [...DEFAULT_TIEBREAKS];
}

export interface TiebreakPlayer {
  id: string;
  rating?: number;
}

/** HistoryGame + forfeit-flagg (walkover / motstander uteble). Et forfeit-resultat
 * "1-0"/"0-1" er en ubrukt runde; "0-0" er dobbel forfeit (0 til begge). */
export interface TiebreakGame extends HistoryGame {
  forfeit?: boolean;
}

export interface StandingRow {
  playerId: string;
  score: number;
  /** null = ikke tilgjengelig (f.eks. rating mangler). */
  values: Record<TiebreakKey, number | null>;
  /** Delt rangering (1,1,3) når alt er likt. */
  rank: number;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

type Kind = "played" | "forfeit" | "bye";
interface Entry {
  round: number;
  opp: string | null;
  pts: number;
  kind: Kind;
}

function byePoints(t: ByeType | undefined): number {
  return t === "half" ? 0.5 : t === "zero" ? 0 : 1;
}

function sidePoints(result: GameResult): [number, number] {
  switch (result) {
    case "1-0":
      return [1, 0];
    case "0-1":
      return [0, 1];
    case "1/2-1/2":
      return [0.5, 0.5];
    default:
      return [0, 0];
  }
}

/** Beregn stilling. `totalRounds` default = høyeste runde i historikken. */
export function computeStandings(
  players: TiebreakPlayer[],
  history: TiebreakGame[],
  order: readonly TiebreakKey[] = DEFAULT_TIEBREAKS,
  totalRounds?: number,
): StandingRow[] {
  const ids = new Set(players.map((p) => p.id));
  for (const g of history) {
    ids.add(g.white);
    if (g.black) ids.add(g.black);
  }
  const R = totalRounds ?? history.reduce((m, g) => Math.max(m, g.round), 0);
  const rating = new Map(players.map((p) => [p.id, p.rating]));

  const entries = new Map<string, Entry[]>();
  for (const id of ids) entries.set(id, []);
  for (const g of history) {
    if (g.black === null || g.result === "bye") {
      entries.get(g.white)!.push({ round: g.round, opp: null, pts: byePoints(g.byeType), kind: "bye" });
      continue;
    }
    const [w, b] = sidePoints(g.result);
    const kind: Kind = g.forfeit || g.result === "0-0" ? "forfeit" : "played";
    entries.get(g.white)!.push({ round: g.round, opp: g.black, pts: w, kind });
    entries.get(g.black)!.push({ round: g.round, opp: g.white, pts: b, kind });
  }

  const score = new Map<string, number>();
  const perRound = new Map<string, number[]>(); // pts per round 1..R (0 om fravær)
  for (const [id, list] of entries) {
    const arr = new Array<number>(R).fill(0);
    let s = 0;
    for (const e of list) {
      s += e.pts;
      if (e.round >= 1 && e.round <= R) arr[e.round - 1] += e.pts;
    }
    score.set(id, r6(s));
    perRound.set(id, arr);
  }

  const cap = 0.5 * R;
  const vo = (id: string) => Math.min(score.get(id)!, cap);

  interface Contribution {
    pts: number;
    value: number; // motstanderens (eller virtuell motstanders) sum
  }
  const contributions = new Map<string, Contribution[]>();
  for (const [id, list] of entries) {
    const cs: Contribution[] = list.map((e) => ({
      pts: e.pts,
      value: e.opp === null ? vo(id) : score.get(e.opp)!,
    }));
    // Runder uten noe parti = nullpoengs bye (fravær/uttrekk) → virtuell motstander.
    const seen = new Set(list.map((e) => e.round));
    for (let r = 1; r <= R; r++) if (!seen.has(r)) cs.push({ pts: 0, value: vo(id) });
    contributions.set(id, cs);
  }

  const values = new Map<string, Record<TiebreakKey, number | null>>();
  const allRated = [...ids].every((id) => typeof rating.get(id) === "number");
  for (const id of ids) {
    const vals = contributions.get(id)!.map((c) => c.value).sort((a, b) => a - b);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const played = entries.get(id)!.filter((e) => e.kind === "played");
    const aro =
      allRated && played.length
        ? Math.floor(sum(played.map((e) => rating.get(e.opp!)!)) / played.length + 0.5)
        : null;
    let cum = 0;
    const prog = perRound.get(id)!.reduce((acc, p) => acc + (cum += p), 0);
    values.set(id, {
      buchholz: r6(sum(vals)),
      buchholz_cut1: r6(sum(vals.slice(1))),
      buchholz_median: r6(sum(vals.length > 2 ? vals.slice(1, -1) : [])),
      sonneborn_berger: r6(sum(contributions.get(id)!.map((c) => c.pts * c.value))),
      direct_encounter: null, // avgjøres i minitabellen
      wins: played.filter((e) => e.pts === 1).length,
      progressive: r6(prog),
      avg_opponent_rating: aro,
    });
  }

  // Innbyrdes: gjennomsnittlig poeng mot hver motstander (flere møter → snitt), forfeit utelatt.
  const h2h = new Map<string, Map<string, number[]>>();
  for (const [id, list] of entries) {
    const m = new Map<string, number[]>();
    for (const e of list) if (e.kind === "played") m.set(e.opp!, [...(m.get(e.opp!) ?? []), e.pts]);
    h2h.set(id, m);
  }
  const miniTable = (group: string[]): Map<string, number> | null => {
    const out = new Map<string, number>();
    for (const a of group) {
      let s = 0;
      for (const b of group) {
        if (a === b) continue;
        const pts = h2h.get(a)!.get(b);
        if (!pts) return null; // ikke alle har møtt hverandre → gjelder ikke
        s += pts.reduce((x, y) => x + y, 0) / pts.length;
      }
      out.set(a, r6(s));
    }
    return out;
  };

  const val = (id: string, k: TiebreakKey) => values.get(id)![k] ?? 0;

  /** Del en gruppe med lik poengsum i ordnede rangklasser (best først). */
  const split = (group: string[], keyIdx: number): string[][] => {
    if (group.length <= 1 || keyIdx >= order.length) return [group];
    const key = order[keyIdx];
    let metric: (id: string) => number;
    if (key === "direct_encounter") {
      const mt = miniTable(group);
      if (!mt) return split(group, keyIdx + 1);
      metric = (id) => mt.get(id)!;
    } else {
      metric = (id) => val(id, key);
    }
    const sorted = [...group].sort((a, b) => metric(b) - metric(a) || (a < b ? -1 : 1));
    const classes: string[][] = [];
    for (const id of sorted) {
      const last = classes[classes.length - 1];
      if (last && metric(last[0]) === metric(id)) last.push(id);
      else classes.push([id]);
    }
    return classes.flatMap((c) =>
      split(c, key === "direct_encounter" && c.length < group.length ? keyIdx : keyIdx + 1),
    );
  };

  const byScore = new Map<number, string[]>();
  for (const id of ids) byScore.set(score.get(id)!, [...(byScore.get(score.get(id)!) ?? []), id]);
  const rows: StandingRow[] = [];
  let rank = 1;
  for (const s of [...byScore.keys()].sort((a, b) => b - a)) {
    for (const cls of split(byScore.get(s)!, 0)) {
      for (const id of [...cls].sort()) {
        rows.push({ playerId: id, score: s, values: values.get(id)!, rank });
      }
      rank += cls.length;
    }
  }
  return rows;
}
