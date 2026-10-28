// Konfigurerbare tiebreaks for sveitsisk/alle-mot-alle. Rene funksjoner over
// historikken fra pairing/types.ts. Følger FIDE C.07 (Tie-Break Regulations,
// gyldig fra 1. sept. 2023), art. 16 «Unplayed Rounds Management»:
//  - ingen «virtuell motstander»-formel med tak; i stedet «dummy» (art. 16.4):
//    en ubrukt runde (bye, forfeit, fravær/uttrekk) i spillerens EGEN tiebreak
//    regnes som parti mot en dummy med like mange poeng som spilleren selv
//    (sluttsum), med resultat lik tildelte poeng.
//  - for MOTSTANDERNES tiebreak (art. 16.3) justeres spillerens sum: bye/forfeit
//    teller med tildelte poeng, men «ønsket bye» (halv/null/fravær) som IKKE
//    etterfølges av noen runde spilleren kunne spille (art. 16.2.5) teller som
//    remis (½).
//  - cut-modifikatorer (art. 16.5): har spilleren forfeit-tap eller ønsket bye,
//    strykes det laveste bidraget fra slike runder i stedet for det laveste
//    bidraget totalt (så lenge det ikke er lavere enn det).
//  - innbyrdes oppgjør er en rekursiv minitabell blant likestilte (art. 6);
//    forfeit utelates (art. 6.1.1).
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

/** played = spilt over brettet. fullBye = pairing-allocated / full-point bye (16.2.1).
 * forfeitWin (16.2.2) / forfeitLoss (16.2.4). requested = ønsket halv/null-bye
 * eller runde uten parti (fravær, uttrekk = null-poengs bye, 16.1.1). */
type Kind = "played" | "forfeitWin" | "forfeitLoss" | "fullBye" | "requested";
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
      const kind: Kind = g.byeType === "half" || g.byeType === "zero" ? "requested" : "fullBye";
      entries.get(g.white)!.push({ round: g.round, opp: null, pts: byePoints(g.byeType), kind });
      continue;
    }
    const [w, b] = sidePoints(g.result);
    const forfeit = g.forfeit || g.result === "0-0";
    const kindOf = (pts: number): Kind => (!forfeit ? "played" : pts > 0 ? "forfeitWin" : "forfeitLoss");
    entries.get(g.white)!.push({ round: g.round, opp: g.black, pts: w, kind: kindOf(w) });
    entries.get(g.black)!.push({ round: g.round, opp: g.white, pts: b, kind: kindOf(b) });
  }
  // Runder uten noe parti = null-poengs bye (fravær/uttrekk, art. 16.1.1) = ønsket bye.
  for (const list of entries.values()) {
    const seen = new Set(list.map((e) => e.round));
    for (let r = 1; r <= R; r++) if (!seen.has(r)) list.push({ round: r, opp: null, pts: 0, kind: "requested" });
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

  // Art. 16.3: summen motstanderne ser. Ønskede byes uten noen etterfølgende
  // «available-to-play»-runde (spilt, full bye, forfeit-seier) regnes som remis.
  const adjusted = new Map<string, number>();
  for (const [id, list] of entries) {
    const availAt = list
      .filter((e) => e.kind === "played" || e.kind === "fullBye" || e.kind === "forfeitWin")
      .reduce((m, e) => Math.max(m, e.round), 0);
    let adj = score.get(id)!;
    for (const e of list) if (e.kind === "requested" && e.round > availAt) adj += 0.5 - e.pts;
    adjusted.set(id, r6(adj));
  }

  interface Contribution {
    pts: number;
    value: number; // motstanderens justerte sum, eller (ubrukt runde) spillerens egen sum
    /** Art. 16.5: forfeit-tap og ønsket bye kan strykes først av en cut. */
    cuttable: boolean;
  }
  const contributions = new Map<string, Contribution[]>();
  for (const [id, list] of entries) {
    contributions.set(
      id,
      list.map((e) =>
        e.kind === "played"
          ? { pts: e.pts, value: adjusted.get(e.opp!)!, cuttable: false }
          : // Art. 16.4: ubrukt runde = parti mot dummy med spillerens egne poeng.
            { pts: e.pts, value: score.get(id)!, cuttable: e.kind === "forfeitLoss" || e.kind === "requested" },
      ),
    );
  }

  /** Sum av verdiene etter å ha strøket `n` laveste (art. 14.1 + 16.5). */
  const cutLowest = (cs: Contribution[], n: number): Contribution[] => {
    let rest = cs.slice().sort((a, b) => a.value - b.value);
    for (let i = 0; i < n && rest.length; i++) {
      // 16.5: lavest av forfeit-tap/ønsket bye, hvis ikke lavere enn laveste totalt.
      const lowest = rest[0].value;
      const idx = rest.findIndex((c) => c.cuttable && c.value >= lowest);
      rest = rest.filter((_, j) => j !== (idx >= 0 ? idx : 0));
    }
    return rest;
  };

  const values = new Map<string, Record<TiebreakKey, number | null>>();
  const allRated = [...ids].every((id) => typeof rating.get(id) === "number");
  for (const id of ids) {
    const cs = contributions.get(id)!;
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const vals = (xs: Contribution[]) => xs.map((c) => c.value);
    const cut1 = cutLowest(cs, 1);
    // Median-1: lavest strykes (med 16.5), deretter høyest.
    const median = cut1.length > 1 ? cut1.slice().sort((a, b) => a.value - b.value).slice(0, -1) : [];
    const played = entries.get(id)!.filter((e) => e.kind === "played");
    const aro =
      allRated && played.length
        ? Math.floor(sum(played.map((e) => rating.get(e.opp!)!)) / played.length + 0.5)
        : null;
    let cum = 0;
    const prog = perRound.get(id)!.reduce((acc, p) => acc + (cum += p), 0);
    values.set(id, {
      buchholz: r6(sum(vals(cs))),
      buchholz_cut1: r6(sum(vals(cut1))),
      buchholz_median: r6(sum(cs.length > 2 ? vals(median) : [])),
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
