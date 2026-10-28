// Digital -> fysisk (M5b): «Last ned turneringsfil» fra en digital turnering.
// Ren funksjon. Lager en hendelseslogg (createTournament, addPlayer, pairRound med
// de faktiske parringene, publishRound, setResult per parti, completeRound) som
// spilles av gjennom den vanlige reduceren – så fila er garantert gyldig, og kan
// importeres i fysisk modus og fortsettes over brettet.
//
// Spillere uten parti i en runde (de dukker opp igjen senere) får 0-poengs frirunde;
// spillere som aldri spiller igjen trekkes før runden. Digitale «forlot»-spillere
// blir trukket.

import { makeEvent } from "@/lib/physical/events";
import { PhysicalError } from "@/lib/physical/errors";
import { replay } from "@/lib/physical/reducer";
import type {
  PhysicalEvent,
  PhysicalEventBody,
  PhysicalPairing,
  PhysicalSettings,
  PhysicalTournament,
  ResultCode,
} from "@/lib/physical/schema";
import { resolveTiebreaks } from "@/lib/tournament/tiebreaks";
import type { GameStatus, ResultSource, TournamentConfig, TournamentStatus } from "@/lib/types";

export interface DigitalExportInput {
  tournament: { id: string; title: string | null; status: TournamentStatus; config: TournamentConfig };
  players: { id: string; displayName: string; status: "active" | "left"; rating?: number | null; club?: string | null; startNo?: number | null }[];
  rounds: { id: string; number: number; phase: string }[];
  games: { roundId: string; whitePlayerId: string; blackPlayerId: string | null; status: GameStatus; slot?: number; resultSource?: ResultSource }[];
}

export type DigitalExportRefusal = "cup" | "playoff" | "roundInProgress" | "invalid";
export type DigitalExportResult =
  | { ok: true; tournament: PhysicalTournament; fileId: string }
  | { ok: false; reason: DigitalExportRefusal };

function resultOf(status: GameStatus, source?: ResultSource): ResultCode {
  const forfeit = source === "walkover" || source === "opponent_absent";
  if (status === "white_win") return forfeit ? "+-" : "1-0";
  if (status === "black_win") return forfeit ? "-+" : "0-1";
  if (status === "draw") return "½-½";
  return "=";
}

export function buildPhysicalFromDigital(input: DigitalExportInput, now = new Date().toISOString()): DigitalExportResult {
  const { tournament: dt } = input;
  if (dt.config.format === "cup") return { ok: false, reason: "cup" };
  if (dt.status === "playoff") return { ok: false, reason: "playoff" };
  const rounds = input.rounds.filter((r) => r.phase === "league").sort((a, b) => a.number - b.number);
  const byRound = new Map(rounds.map((r) => [r.id, input.games.filter((g) => g.roundId === r.id)]));
  for (const gs of byRound.values()) if (gs.some((g) => g.status === "live")) return { ok: false, reason: "roundInProgress" };
  const played = rounds.filter((r) => (byRound.get(r.id) ?? []).length > 0);

  const system = dt.config.pairingSystem ?? "monrad";
  const settings: PhysicalSettings = {
    system,
    rounds: Math.min(99, Math.max(1, dt.config.leagueRounds, played.length)),
    ...(system === "roundRobin" && dt.config.doubleRoundRobin ? { doubleRoundRobin: true } : {}),
    tiebreaks: resolveTiebreaks(dt.config.tiebreaks),
    byePoints: dt.config.byePoints === 0.5 ? 0.5 : 1,
    allowLateEntry: !!dt.config.fromPhysical?.allowFreeJoin,
    ...(dt.config.fromPhysical?.groupLabel ? { groupLabel: dt.config.fromPhysical.groupLabel } : {}),
  };
  const fileId = dt.config.fromPhysical?.sourceId ?? dt.id;

  let n = 0;
  const events: PhysicalEvent[] = [];
  const push = (body: PhysicalEventBody) => {
    n++;
    events.push(makeEvent(body, { id: `m5b-${n}`, at: new Date(Date.parse(now) + n).toISOString() }));
  };

  push({ type: "createTournament", tournamentId: fileId, title: (dt.title ?? "").trim().slice(0, 80) || "Sjakkturnering", settings });

  const players = input.players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.startNo ?? 1e9) - (b.p.startNo ?? 1e9) || a.i - b.i)
    .map((x) => x.p);
  for (const p of players) {
    const rating = typeof p.rating === "number" && Number.isInteger(p.rating) && p.rating >= 0 && p.rating <= 3500 ? p.rating : undefined;
    push({
      type: "addPlayer",
      playerId: p.id,
      name: p.displayName,
      ...(rating !== undefined ? { rating } : {}),
      ...(p.club ? { club: p.club } : {}),
    });
  }

  const appears = (rid: string) => {
    const s = new Set<string>();
    for (const g of byRound.get(rid) ?? []) {
      s.add(g.whitePlayerId);
      if (g.blackPlayerId) s.add(g.blackPlayerId);
    }
    return s;
  };
  const sets = played.map((r) => appears(r.id));
  const withdrawn = new Set<string>();

  played.forEach((r, ri) => {
    const here = sets[ri];
    for (const p of players) {
      if (here.has(p.id) || withdrawn.has(p.id)) continue;
      if (!sets.slice(ri + 1).some((s) => s.has(p.id))) {
        push({ type: "withdrawPlayer", playerId: p.id });
        withdrawn.add(p.id);
      }
    }
    const games = [...(byRound.get(r.id) ?? [])].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    const pairings: PhysicalPairing[] = games.map((g, i) => {
      const bye = g.blackPlayerId === null;
      return {
        board: i + 1,
        white: g.whitePlayerId,
        black: g.blackPlayerId,
        result: null,
        ...(bye ? { byeType: g.status === "draw" ? ("half" as const) : g.status === "aborted" ? ("zero" as const) : ("full" as const) } : {}),
      };
    });
    for (const p of players) {
      if (!here.has(p.id) && !withdrawn.has(p.id)) pairings.push({ board: pairings.length + 1, white: p.id, black: null, byeType: "zero", result: null });
    }
    push({ type: "pairRound", round: r.number, pairings });
    push({ type: "publishRound", round: r.number });
    games.forEach((g, i) => {
      if (g.blackPlayerId !== null) push({ type: "setResult", round: r.number, board: i + 1, result: resultOf(g.status, g.resultSource) });
    });
    push({ type: "completeRound", round: r.number });
  });

  for (const p of players) {
    if (p.status === "left" && !withdrawn.has(p.id)) {
      push({ type: "withdrawPlayer", playerId: p.id });
      withdrawn.add(p.id);
    }
  }
  if (dt.status === "finished" && played.length > 0) push({ type: "finishTournament" });

  try {
    return { ok: true, tournament: replay(events), fileId };
  } catch (e) {
    if (e instanceof PhysicalError) return { ok: false, reason: "invalid" };
    throw e;
  }
}
