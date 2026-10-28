// Ren, hendelsesstyrt reducer for fysiske turneringer. State = replay(events).
// Ingen I/O, ingen klokke, ingen tilfeldighet (id/tid kommer i hendelsen).
// Reducer validerer ALT og kaster PhysicalError (norsk melding). Parringsmotoren
// kalles aldri her: pairRound lagrer ferdig beregnede parringer i hendelsen.

import { bracketRounds, cupBracketSize } from "@/lib/tournament/bracket";
import { roundRobinRounds } from "@/lib/tournament/pairing/roundRobin";
import { TIEBREAK_KEYS } from "@/lib/tournament/tiebreaks";
import { fail } from "./errors";
import { isIsoTimestamp, makeEvent, type EventMeta } from "./events";
import {
  PHYSICAL_SYSTEMS,
  RESULT_CODES,
  SCHEMA_VERSION,
  type PhysicalEvent,
  type PhysicalEventBody,
  type PhysicalPairing,
  type PhysicalPlayer,
  type PhysicalRound,
  type PhysicalSettings,
  type PhysicalTournament,
  type ResultCode,
} from "./schema";

/** Antall runder turneringen har i alt. Utslag og alle-mot-alle utledes av spillerantallet. */
export function totalRounds(t: Pick<PhysicalTournament, "settings" | "players">): number {
  const n = t.players.length;
  switch (t.settings.system) {
    case "knockout":
      return n < 2 ? 0 : bracketRounds(cupBracketSize(n));
    case "roundRobin":
      return roundRobinRounds(n, !!t.settings.doubleRoundRobin);
    default:
      return t.settings.rounds;
  }
}

function validateSettings(s: PhysicalSettings): PhysicalSettings {
  if (!s || typeof s !== "object") fail("badSettings");
  if (!PHYSICAL_SYSTEMS.includes(s.system)) fail("badSettings");
  if (!Number.isInteger(s.rounds) || s.rounds < 1 || s.rounds > 99) fail("badSettings");
  if (!Array.isArray(s.tiebreaks)) fail("badSettings");
  const seen = new Set<string>();
  for (const k of s.tiebreaks) {
    if (!TIEBREAK_KEYS.includes(k) || seen.has(k)) fail("badSettings");
    seen.add(k);
  }
  if (s.byePoints !== 1 && s.byePoints !== 0.5) fail("badSettings");
  if (typeof s.allowLateEntry !== "boolean") fail("badSettings");
  return {
    system: s.system,
    rounds: s.rounds,
    ...(s.system === "roundRobin" ? { doubleRoundRobin: !!s.doubleRoundRobin } : {}),
    tiebreaks: [...s.tiebreaks],
    byePoints: s.byePoints,
    allowLateEntry: s.allowLateEntry,
    ...(s.groupLabel?.trim() ? { groupLabel: s.groupLabel.trim().slice(0, 30) } : {}),
  };
}

function cleanName(raw: unknown): string {
  const n = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!n || n.length > 80) fail("nameRequired");
  return n;
}
function cleanRating(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 3500) fail("badRating");
  return raw;
}
function cleanClub(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const c = typeof raw === "string" ? raw.trim().slice(0, 60) : "";
  return c || undefined;
}

function playerOf(t: PhysicalTournament, id: unknown): PhysicalPlayer {
  const p = t.players.find((x) => x.id === id);
  if (!p) fail("playerUnknown");
  return p;
}
function roundOf(t: PhysicalTournament, n: unknown): PhysicalRound {
  const r = t.rounds.find((x) => x.number === n);
  if (!r) fail("roundNotFound");
  return r;
}

/** Strukturell validering av en komplett runde med parringer. */
function checkPairings(t: PhysicalTournament, round: number, raw: PhysicalPairing[]): PhysicalPairing[] {
  if (!Array.isArray(raw) || raw.length === 0) fail("pairingEmpty");
  const boards = new Set<number>();
  const seen = new Set<string>();
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const out: PhysicalPairing[] = [];
  for (const p of raw) {
    if (!p || !Number.isInteger(p.board) || p.board < 1 || boards.has(p.board)) fail("pairingBoard");
    boards.add(p.board);
    for (const id of [p.white, p.black]) {
      if (id === null) continue;
      if (!byId.has(id)) fail("pairingUnknownPlayer");
      if (seen.has(id)) fail("pairingDuplicatePlayer");
      seen.add(id);
    }
    if (typeof p.white !== "string") fail("pairingUnknownPlayer");
    if (p.black === p.white) fail("pairingDuplicatePlayer");
    const clean: PhysicalPairing = { board: p.board, white: p.white, black: p.black ?? null, result: null };
    if (clean.black === null) {
      const bt = p.byeType ?? "full";
      if (bt !== "full" && bt !== "half" && bt !== "zero") fail("byeBadType");
      clean.byeType = bt;
    }
    if (p.rematch) clean.rematch = true;
    if (p.manual) clean.manual = true;
    out.push(clean);
  }
  if (t.settings.system !== "knockout") {
    for (const p of t.players) {
      if (p.status === "withdrawn" && seen.has(p.id)) fail("pairingInactivePlayer");
      if (p.status === "active" && !seen.has(p.id)) fail("pairingMissingPlayer");
    }
    for (const rq of t.byeRequests) {
      if (rq.round !== round) continue;
      const pl = byId.get(rq.playerId);
      if (!pl || pl.status !== "active") continue;
      const hit = out.find((x) => x.black === null && x.white === rq.playerId);
      if (!hit || hit.byeType !== rq.byeType) fail("pairingByeRequest");
    }
  }
  return out.sort((a, b) => a.board - b.board);
}

/** Walkover-resultat når en eller begge spillerne er trukket, ellers null. */
export function forfeitResult(
  g: Pick<PhysicalPairing, "white" | "black">,
  isWithdrawn: (id: string) => boolean,
): ResultCode | null {
  if (g.black === null) return null;
  const w = isWithdrawn(g.white);
  const b = isWithdrawn(g.black);
  if (w && b) return "=";
  if (w) return "-+";
  if (b) return "+-";
  return null;
}

/** Sett walkover på uferdige brett med trukne spillere (valgfritt: bare brett med `only`). */
function forfeitOpenBoards(s: Omit<PhysicalTournament, "events">, round: PhysicalRound, only?: string) {
  const out = new Set(s.players.filter((p) => p.status === "withdrawn").map((p) => p.id));
  for (const g of round.pairings) {
    if (g.black === null || g.result) continue;
    if (only && g.white !== only && g.black !== only) continue;
    const res = forfeitResult(g, (id) => out.has(id));
    if (!res) continue;
    if (s.settings.system === "knockout" && res === "=") continue;
    g.result = res;
    g.resultSource = "arbiter";
  }
}

export function assertCanPair(t: PhysicalTournament, round: number) {
  if (t.rounds.length + 1 !== round) fail("roundWrongNumber");
  const last = t.rounds[t.rounds.length - 1];
  if (last && last.status !== "completed") fail("roundPreviousOpen");
  if (round > totalRounds(t)) fail("roundTooMany");
  if (t.status === "finished") fail("finished");
  if (t.players.filter((p) => p.status === "active").length < 2 && t.settings.system !== "knockout") fail("notEnoughPlayers");
  if (t.players.length < 2) fail("notEnoughPlayers");
}

function apply(t: PhysicalTournament | null, e: PhysicalEvent): PhysicalTournament {
  if (!e || typeof e !== "object" || typeof e.type !== "string") fail("badEvent");
  if (typeof e.id !== "string" || !e.id) fail("badEvent");
  if (!isIsoTimestamp(e.at)) fail("badTimestamp");

  if (e.type === "createTournament") {
    if (t) fail("alreadyCreated");
    if (typeof e.tournamentId !== "string" || !e.tournamentId) fail("badEvent");
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!title || title.length > 80) fail("badTitle");
    return {
      schemaVersion: SCHEMA_VERSION,
      id: e.tournamentId,
      title,
      createdAt: e.at,
      status: "running",
      settings: validateSettings(e.settings),
      players: [],
      rounds: [],
      byeRequests: [],
      events: [e],
    };
  }
  if (!t) fail("notCreated");
  if (t.events.some((x) => x.id === e.id)) fail("duplicateEventId");
  if (t.status === "finished") fail("finished");

  const { events, ...rest } = t;
  const s = structuredClone(rest) as Omit<PhysicalTournament, "events">;

  switch (e.type) {
    case "addPlayer": {
      if (typeof e.playerId !== "string" || !e.playerId) fail("badEvent");
      if (s.players.some((p) => p.id === e.playerId)) fail("playerDuplicate");
      const name = cleanName(e.name);
      const rating = cleanRating(e.rating);
      const club = cleanClub(e.club);
      const player: PhysicalPlayer = {
        id: e.playerId,
        startNo: s.players.reduce((m, p) => Math.max(m, p.startNo), 0) + 1,
        name,
        ...(rating !== undefined ? { rating } : {}),
        ...(club ? { club } : {}),
        status: "active",
      };
      if (s.rounds.length > 0) {
        if (!s.settings.allowLateEntry) fail("lateEntryOff");
        if (s.settings.system !== "monrad" && s.settings.system !== "swiss") fail("lateEntryUnsupported");
        player.lateEntryRound = s.rounds.length + 1;
        if (e.missedRoundPoints !== undefined && e.missedRoundPoints !== 0 && e.missedRoundPoints !== 0.5) fail("badEvent");
        if (e.missedRoundPoints === 0.5) player.missedRoundPoints = 0.5;
      }
      s.players.push(player);
      break;
    }
    case "editPlayer": {
      const p = playerOf(s as PhysicalTournament, e.playerId);
      const patch = e.patch ?? {};
      if (patch.name !== undefined) p.name = cleanName(patch.name);
      if (patch.rating !== undefined) {
        const r = cleanRating(patch.rating);
        if (r === undefined) delete p.rating;
        else p.rating = r;
      }
      if (patch.club !== undefined) {
        const c = cleanClub(patch.club);
        if (c === undefined) delete p.club;
        else p.club = c;
      }
      break;
    }
    case "withdrawPlayer": {
      const p = playerOf(s as PhysicalTournament, e.playerId);
      if (p.status === "withdrawn") fail("playerNotActive");
      p.status = "withdrawn";
      if (e.forfeit) {
        const open = s.rounds[s.rounds.length - 1];
        if (open && open.status === "published") forfeitOpenBoards(s, open, p.id);
      }
      break;
    }
    case "reinstatePlayer": {
      const p = playerOf(s as PhysicalTournament, e.playerId);
      if (p.status !== "withdrawn") fail("playerNotWithdrawn");
      p.status = "active";
      break;
    }
    case "requestBye": {
      const p = playerOf(s as PhysicalTournament, e.playerId);
      if (s.settings.system === "knockout") fail("byeUnsupported");
      if (e.byeType !== "half" && e.byeType !== "zero") fail("byeBadType");
      if (!Number.isInteger(e.round) || e.round <= s.rounds.length || e.round > totalRounds(s)) fail("byeBadRound");
      if (p.status !== "active") fail("playerNotActive");
      s.byeRequests = s.byeRequests.filter((r) => !(r.playerId === p.id && r.round === e.round));
      s.byeRequests.push({ playerId: p.id, round: e.round, byeType: e.byeType });
      break;
    }
    case "cancelByeRequest": {
      playerOf(s as PhysicalTournament, e.playerId);
      if (!Number.isInteger(e.round) || e.round <= s.rounds.length) fail("byeBadRound");
      s.byeRequests = s.byeRequests.filter((r) => !(r.playerId === e.playerId && r.round === e.round));
      break;
    }
    case "pairRound": {
      assertCanPair(s as PhysicalTournament, e.round);
      s.rounds.push({
        number: e.round,
        status: "draft",
        pairings: checkPairings(s as PhysicalTournament, e.round, e.pairings),
      });
      break;
    }
    case "manualPairing": {
      const r = roundOf(s as PhysicalTournament, e.round);
      if (r.status === "completed") fail("roundCompleted");
      if (r.status !== "draft" && !e.afterPublish) fail("roundNotDraft");
      const before = r.pairings;
      r.pairings = checkPairings(s as PhysicalTournament, e.round, e.pairings).map((p) => {
        const old = before.find((o) => o.board === p.board && o.white === p.white && o.black === p.black);
        return { ...p, manual: true, ...(old?.result ? { result: old.result, resultSource: old.resultSource } : {}) };
      });
      break;
    }
    case "swapPairing": {
      const r = roundOf(s as PhysicalTournament, e.round);
      if (r.status === "completed") fail("roundCompleted");
      if (r.status !== "draft" && !e.afterPublish) fail("roundNotDraft");
      const pa = r.pairings.find((p) => p.board === e.a?.board);
      const pb = r.pairings.find((p) => p.board === e.b?.board);
      if (!pa || !pb) fail("boardNotFound");
      const sa = e.a.side;
      const sb = e.b.side;
      if ((sa !== "white" && sa !== "black") || (sb !== "white" && sb !== "black")) fail("pairingBadSlot");
      if (pa === pb && sa === sb) fail("pairingBadSlot");
      if (pa[sa] === null || pb[sb] === null) fail("pairingBadSlot");
      const tmp = pa[sa] as string;
      (pa as unknown as Record<string, string | null>)[sa] = pb[sb];
      (pb as unknown as Record<string, string | null>)[sb] = tmp;
      pa.manual = true;
      pb.manual = true;
      // Nye motstandere: gamle resultater gjelder ikke lenger.
      for (const g of [pa, pb]) {
        g.result = null;
        delete g.resultSource;
      }
      break;
    }
    case "publishRound": {
      const r = roundOf(s as PhysicalTournament, e.round);
      if (r.status !== "draft") fail("roundNotDraft");
      r.status = "published";
      if (e.autoForfeit) forfeitOpenBoards(s, r);
      break;
    }
    case "setResult": {
      const r = roundOf(s as PhysicalTournament, e.round);
      if (r.status === "completed") fail("roundCompleted");
      if (r.status !== "published") fail("roundNotPublished");
      const p = r.pairings.find((x) => x.board === e.board);
      if (!p) fail("boardNotFound");
      if (!RESULT_CODES.includes(e.result)) fail("resultInvalid");
      if (p.black === null) fail("resultOnBye");
      if (s.settings.system === "knockout" && (e.result === "½-½" || e.result === "=")) fail("resultNoDraw");
      p.result = e.result;
      p.resultSource = "arbiter";
      break;
    }
    case "clearResult": {
      const r = roundOf(s as PhysicalTournament, e.round);
      if (r.status === "completed") fail("roundCompleted");
      const p = r.pairings.find((x) => x.board === e.board);
      if (!p) fail("boardNotFound");
      if (p.black === null) fail("resultOnBye");
      p.result = null;
      delete p.resultSource;
      break;
    }
    case "completeRound": {
      const r = roundOf(s as PhysicalTournament, e.round);
      if (r.status === "completed") fail("roundCompleted");
      if (r.status !== "published") fail("roundNotPublished");
      if (r.pairings.some((p) => p.black !== null && !p.result)) fail("resultsMissing");
      r.status = "completed";
      break;
    }
    case "finishTournament": {
      if (s.rounds.length === 0) fail("nothingToFinish");
      if (s.rounds.some((r) => r.status !== "completed")) fail("roundsOpen");
      s.status = "finished";
      break;
    }
    default:
      fail("badEvent");
  }
  return { ...s, events: [...events, e] };
}

/** Anvend én hendelse. Kaster PhysicalError ved ugyldig hendelse; state er uendret. */
export function reduce(state: PhysicalTournament | null, event: PhysicalEvent): PhysicalTournament {
  return apply(state, event);
}

/** Bygg state fra en logg. */
export function replay(events: readonly PhysicalEvent[]): PhysicalTournament {
  if (!Array.isArray(events) || events.length === 0) fail("corruptLog");
  if (events[0].type !== "createTournament") fail("corruptLog");
  let t: PhysicalTournament | null = null;
  for (const e of events) t = apply(t, e);
  return t as PhysicalTournament;
}

/** Fjern siste hendelse og spill av på nytt. */
export function undo(state: PhysicalTournament): PhysicalTournament {
  if (state.events.length <= 1) fail("cannotUndoCreate");
  return replay(state.events.slice(0, -1));
}

export function canUndo(state: PhysicalTournament): boolean {
  return state.events.length > 1;
}

/** Praktisk: lag hendelse med id/tid og anvend. */
export function dispatch(state: PhysicalTournament, body: PhysicalEventBody, meta?: EventMeta): PhysicalTournament {
  return reduce(state, makeEvent(body, meta));
}

/** Opprett ny turnering fra settings (første hendelse). */
export function createTournament(
  args: { id: string; title: string; settings: PhysicalSettings },
  meta?: EventMeta,
): PhysicalTournament {
  return reduce(null, makeEvent({ type: "createTournament", tournamentId: args.id, title: args.title, settings: args.settings }, meta));
}
