// Rene hjelpere for arrangørens runde-skjerm (M2): fremdrift, tastatur, trekk-konsekvenser,
// krysstabell per runde og tekst til angre-toast. Ingen I/O, ingen React.

import { no } from "@/lib/locale/no";
import { forfeitResult } from "./reducer";
import type { PhysicalEvent, PhysicalPairing, PhysicalRound, PhysicalTournament, ResultCode } from "./schema";
import { resultPoints, standings, type StandingWithPlayer } from "./selectors";

// ---- fremdrift ----

export interface RoundProgress {
  /** Partier som skal ha resultat (ikke frirunder). */
  total: number;
  done: number;
  /** Brettnumre uten resultat. */
  missing: number[];
}

export function roundProgress(r: Pick<PhysicalRound, "pairings">): RoundProgress {
  const games = r.pairings.filter((p) => p.black !== null);
  const missing = games.filter((p) => !p.result).map((p) => p.board);
  return { total: games.length, done: games.length - missing.length, missing };
}

/** Neste brett uten resultat etter `after` (med omløp). null når alt er ført. */
export function nextMissingBoard(r: Pick<PhysicalRound, "pairings">, after: number): number | null {
  const { missing } = roundProgress(r);
  if (missing.length === 0) return null;
  return missing.find((b) => b > after) ?? missing[0];
}

// ---- tastatur ----

/** Tast → resultat. `clear` = fjern. Utslag har ikke remis. Returnerer null for andre taster. */
export function resultForKey(key: string, knockout: boolean): ResultCode | "clear" | null {
  switch (key) {
    case "1":
      return "1-0";
    case "0":
      return "0-1";
    case "=":
    case "h":
    case "H":
    case "2":
      return knockout ? null : "½-½";
    case "+":
      return "+-";
    case "-":
      return "-+";
    case "Backspace":
    case "Delete":
      return "clear";
    default:
      return null;
  }
}

// ---- trekk ----

export interface WithdrawImpact {
  /** Brett som får walkover automatisk (publisert runde). */
  forfeits: { board: number; result: ResultCode; opponentId: string | null }[];
  /** Spilleren står i et utkast: walkover settes når runden publiseres. */
  inDraft: boolean;
}

export function withdrawImpact(t: PhysicalTournament, playerId: string): WithdrawImpact {
  const last = t.rounds[t.rounds.length - 1];
  const out: WithdrawImpact = { forfeits: [], inDraft: false };
  if (!last || last.status === "completed") return out;
  const involved = (g: PhysicalPairing) => g.white === playerId || g.black === playerId;
  if (last.status === "draft") {
    out.inDraft = last.pairings.some(involved);
    return out;
  }
  const withdrawn = new Set(t.players.filter((p) => p.status === "withdrawn").map((p) => p.id));
  withdrawn.add(playerId);
  for (const g of last.pairings) {
    if (g.black === null || g.result || !involved(g)) continue;
    const res = forfeitResult(g, (id) => withdrawn.has(id));
    if (!res || (t.settings.system === "knockout" && res === "=")) continue;
    out.forfeits.push({ board: g.board, result: res, opponentId: g.white === playerId ? g.black : g.white });
  }
  return out;
}

// ---- krysstabell per runde ----

export interface CrossCell {
  round: number;
  kind: "game" | "bye" | "pending" | "missed" | "absent";
  /** Motstanderens startnummer (kind=game|pending). */
  opp?: number;
  colour?: "W" | "B";
  /** Poeng for raden-spilleren; null = ikke spilt ennå. */
  points: number | null;
  forfeit?: boolean;
}
export interface CrossRow {
  player: StandingWithPlayer["player"];
  rank: number;
  score: number;
  cells: CrossCell[];
}

export function crosstableByRound(t: PhysicalTournament): { rounds: number[]; rows: CrossRow[] } {
  const rows = standings(t, { includeOpen: true });
  const startNo = new Map(t.players.map((p) => [p.id, p.startNo]));
  const shown = t.rounds.filter((r) => r.status !== "draft");
  return {
    rounds: shown.map((r) => r.number),
    rows: rows.map((row) => {
      const pl = row.player;
      const cells: CrossCell[] = shown.map((r): CrossCell => {
        const g = r.pairings.find((x) => x.white === pl.id || x.black === pl.id);
        if (!g) {
          if (pl.missedRoundPoints === 0.5 && pl.lateEntryRound !== undefined && r.number < pl.lateEntryRound)
            return { round: r.number, kind: "missed", points: 0.5 };
          if (pl.lateEntryRound !== undefined && r.number < pl.lateEntryRound) return { round: r.number, kind: "missed", points: 0 };
          return { round: r.number, kind: "absent", points: 0 };
        }
        if (g.black === null) {
          const pts = g.byeType === "half" ? 0.5 : g.byeType === "zero" ? 0 : 1;
          return { round: r.number, kind: "bye", points: pts };
        }
        const white = g.white === pl.id;
        const opp = startNo.get(white ? g.black : g.white);
        const colour = white ? "W" : "B";
        if (!g.result) return { round: r.number, kind: "pending", opp, colour, points: null };
        const [w, b] = resultPoints(g.result);
        const forfeit = g.result === "+-" || g.result === "-+" || g.result === "=";
        return { round: r.number, kind: "game", opp, colour, points: white ? w : b, ...(forfeit ? { forfeit } : {}) };
      });
      return { player: pl, rank: row.rank, score: row.score, cells };
    }),
  };
}

// ---- angre-toast ----

const nameOf = (t: PhysicalTournament, id: string | null) => (id ? t.players.find((p) => p.id === id)?.name ?? "?" : "–");

/** Kort norsk tekst for siste hendelse (state ETTER hendelsen). null = ingen toast. */
export function describeEvent(t: PhysicalTournament, e: PhysicalEvent): string | null {
  const x = no.physical.toast;
  switch (e.type) {
    case "setResult": {
      const g = t.rounds.find((r) => r.number === e.round)?.pairings.find((p) => p.board === e.board);
      return g ? x.result(e.board, nameOf(t, g.white), nameOf(t, g.black), no.physical.results[e.result]) : null;
    }
    case "clearResult":
      return x.cleared(e.board);
    case "publishRound":
      return x.published(e.round);
    case "completeRound":
      return x.completed(e.round);
    case "pairRound":
      return x.paired(e.round);
    case "withdrawPlayer": {
      const n = nameOf(t, e.playerId);
      return e.forfeit ? x.withdrawnForfeit(n) : x.withdrawn(n);
    }
    case "reinstatePlayer":
      return x.reinstated(nameOf(t, e.playerId));
    case "addPlayer":
      return x.added(e.name);
    case "requestBye":
      return x.byeSet(nameOf(t, e.playerId), e.round);
    case "cancelByeRequest":
      return x.byeCleared(nameOf(t, e.playerId), e.round);
    case "swapPairing":
    case "manualPairing":
      return x.pairingChanged(e.round);
    case "finishTournament":
      return x.finished;
    default:
      return null;
  }
}
