import { describe, expect, it } from "vitest";
import { PhysicalError, type PhysicalErrorCode } from "@/lib/physical/errors";
import { makeEvent } from "@/lib/physical/events";
import { canUndo, createTournament, dispatch, reduce, replay, totalRounds, undo } from "@/lib/physical/reducer";
import { nextRoundPairing, pairNextRound } from "@/lib/physical/selectors";
import type { PhysicalEventBody, PhysicalTournament } from "@/lib/physical/schema";
import { baseSettings, meta, newTournament, playRound } from "./helpers";

function expectCode(fn: () => unknown, code: PhysicalErrorCode) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PhysicalError);
    expect((e as PhysicalError).code).toBe(code);
    expect((e as PhysicalError).message.length).toBeGreaterThan(3);
    return;
  }
  throw new Error(`forventet feil ${code}, men ingen ble kastet`);
}
const d = (t: PhysicalTournament, b: PhysicalEventBody) => dispatch(t, b, meta());

describe("replay / determinisme / undo", () => {
  it("replay(events) gir identisk state, også etter JSON-rundtur", () => {
    let t = newTournament({}, 6);
    t = playRound(t);
    t = playRound(t);
    expect(replay(t.events)).toEqual(t);
    expect(replay(JSON.parse(JSON.stringify(t.events)))).toEqual(t);
  });

  it("reduce muterer ikke inndata-state", () => {
    const t = newTournament({}, 4);
    const snapshot = JSON.stringify(t);
    d(t, { type: "addPlayer", playerId: "x", name: "X" });
    expect(JSON.stringify(t)).toBe(snapshot);
  });

  it("pairRound lagrer parringer: replay kaller ikke motoren (state uavhengig av byttet motor)", () => {
    let t = newTournament({}, 4);
    t = pairNextRound(t, meta());
    const stored = t.events[t.events.length - 1];
    // Samme hendelse spilles av uendret selv om vi ikke har tilgang til motoren
    expect(replay([...t.events.slice(0, -1), stored]).rounds[0].pairings).toEqual(t.rounds[0].pairings);
  });

  it("undo fjerner siste hendelse og er identisk med replay av prefikset", () => {
    let t = newTournament({}, 4);
    const before = t;
    t = d(t, { type: "addPlayer", playerId: "extra", name: "Ekstra" });
    expect(undo(t)).toEqual(before);
    expect(canUndo(before)).toBe(true);
  });

  it("undo midt i en runde angrer resultat, og kan gjentas helt tilbake til opprettelsen", () => {
    let t = newTournament({}, 4);
    t = pairNextRound(t, meta());
    t = d(t, { type: "publishRound", round: 1 });
    t = d(t, { type: "setResult", round: 1, board: 1, result: "1-0" });
    expect(undo(t).rounds[0].pairings[0].result).toBeNull();
    let u = t;
    while (canUndo(u)) u = undo(u);
    expect(u.events).toHaveLength(1);
    expect(u.players).toHaveLength(0);
    expectCode(() => undo(u), "cannotUndoCreate");
  });

  it("korrupt logg avvises", () => {
    expectCode(() => replay([]), "corruptLog");
    const t = newTournament({}, 2);
    expectCode(() => replay(t.events.slice(1)), "corruptLog");
  });
});

describe("validering: createTournament", () => {
  const mk = (title: string, s = baseSettings()) => () => createTournament({ id: "x", title, settings: s }, meta());
  it("krever navn og gyldige innstillinger", () => {
    expectCode(mk("  "), "badTitle");
    expectCode(mk("A".repeat(81)), "badTitle");
    expectCode(mk("A", baseSettings({ rounds: 0 })), "badSettings");
    expectCode(mk("A", baseSettings({ rounds: 2.5 })), "badSettings");
    expectCode(mk("A", { ...baseSettings(), system: "foo" as never }), "badSettings");
    expectCode(mk("A", { ...baseSettings(), byePoints: 2 as never }), "badSettings");
    expectCode(mk("A", { ...baseSettings(), tiebreaks: ["buchholz", "buchholz"] }), "badSettings");
    expectCode(mk("A", { ...baseSettings(), tiebreaks: ["x" as never] }), "badSettings");
  });
  it("kan ikke opprettes to ganger, og andre hendelser krever opprettelse", () => {
    const t = newTournament({}, 2);
    expectCode(() => reduce(t, makeEvent({ type: "createTournament", tournamentId: "y", title: "B", settings: baseSettings() }, meta())), "alreadyCreated");
    expectCode(() => reduce(null, makeEvent({ type: "addPlayer", playerId: "a", name: "A" }, meta())), "notCreated");
  });
  it("avviser ugyldig tidsstempel, tom id og dobbel id", () => {
    const t = newTournament({}, 2);
    expectCode(() => reduce(t, makeEvent({ type: "addPlayer", playerId: "z", name: "Z" }, { id: "q", at: "i går" })), "badTimestamp");
    expectCode(() => reduce(t, makeEvent({ type: "addPlayer", playerId: "z", name: "Z" }, { id: "", at: "2026-10-28T10:00:00Z" })), "badEvent");
    const id = t.events[1].id;
    expectCode(() => reduce(t, makeEvent({ type: "addPlayer", playerId: "z", name: "Z" }, { id, at: "2026-10-28T10:00:00Z" })), "duplicateEventId");
  });
});

describe("validering: spillere", () => {
  it("addPlayer: navn, rating, duplikat; startNo økes; navn trimmes", () => {
    let t = newTournament({}, 0);
    t = d(t, { type: "addPlayer", playerId: "a", name: "  Kari   Nordmann ", rating: 1500, club: " 7A " });
    t = d(t, { type: "addPlayer", playerId: "b", name: "Ola" });
    expect(t.players.map((p) => [p.startNo, p.name, p.club])).toEqual([[1, "Kari Nordmann", "7A"], [2, "Ola", undefined]]);
    expectCode(() => d(t, { type: "addPlayer", playerId: "a", name: "Annen" }), "playerDuplicate");
    expectCode(() => d(t, { type: "addPlayer", playerId: "c", name: " " }), "nameRequired");
    expectCode(() => d(t, { type: "addPlayer", playerId: "c", name: "C", rating: -1 }), "badRating");
    expectCode(() => d(t, { type: "addPlayer", playerId: "c", name: "C", rating: 12.5 }), "badRating");
  });
  it("editPlayer endrer felt og kan fjerne rating/klubb", () => {
    let t = newTournament({}, 2);
    t = d(t, { type: "editPlayer", playerId: "p1", patch: { name: "Ny", rating: 1234, club: "K" } });
    expect(t.players[0]).toMatchObject({ name: "Ny", rating: 1234, club: "K" });
    t = d(t, { type: "editPlayer", playerId: "p1", patch: { rating: null, club: null } });
    expect(t.players[0].rating).toBeUndefined();
    expect(t.players[0].club).toBeUndefined();
    expectCode(() => d(t, { type: "editPlayer", playerId: "nope", patch: { name: "x" } }), "playerUnknown");
    expectCode(() => d(t, { type: "editPlayer", playerId: "p1", patch: { name: "" } }), "nameRequired");
  });
  it("withdraw / reinstate", () => {
    let t = newTournament({}, 3);
    t = d(t, { type: "withdrawPlayer", playerId: "p2" });
    expect(t.players[1].status).toBe("withdrawn");
    expectCode(() => d(t, { type: "withdrawPlayer", playerId: "p2" }), "playerNotActive");
    expectCode(() => d(t, { type: "reinstatePlayer", playerId: "p1" }), "playerNotWithdrawn");
    t = d(t, { type: "reinstatePlayer", playerId: "p2" });
    expect(t.players[1].status).toBe("active");
    expectCode(() => d(t, { type: "withdrawPlayer", playerId: "zz" }), "playerUnknown");
  });
  it("requestBye / cancelByeRequest", () => {
    let t = newTournament({}, 4);
    t = d(t, { type: "requestBye", playerId: "p1", round: 1, byeType: "half" });
    t = d(t, { type: "requestBye", playerId: "p1", round: 1, byeType: "zero" });
    expect(t.byeRequests).toEqual([{ playerId: "p1", round: 1, byeType: "zero" }]);
    expectCode(() => d(t, { type: "requestBye", playerId: "p1", round: 6, byeType: "half" }), "byeBadRound");
    expectCode(() => d(t, { type: "requestBye", playerId: "p1", round: 0, byeType: "half" }), "byeBadRound");
    expectCode(() => d(t, { type: "requestBye", playerId: "p1", round: 1, byeType: "full" as never }), "byeBadType");
    expectCode(() => d(t, { type: "requestBye", playerId: "x", round: 1, byeType: "half" }), "playerUnknown");
    t = d(t, { type: "cancelByeRequest", playerId: "p1", round: 1 });
    expect(t.byeRequests).toEqual([]);
    t = pairNextRound(t, meta());
    expectCode(() => d(t, { type: "requestBye", playerId: "p1", round: 1, byeType: "half" }), "byeBadRound");
    const ko = newTournament({ system: "knockout" }, 4);
    expectCode(() => d(ko, { type: "requestBye", playerId: "p1", round: 1, byeType: "half" }), "byeUnsupported");
  });
  it("sen påmelding: krever innstilling og Monrad/sveitsisk", () => {
    let t = newTournament({}, 4);
    t = playRound(t);
    t = d(t, { type: "addPlayer", playerId: "late", name: "Sen" });
    expect(t.players[4].lateEntryRound).toBe(2);
    const off = playRound(newTournament({ allowLateEntry: false }, 4));
    expectCode(() => d(off, { type: "addPlayer", playerId: "l", name: "L" }), "lateEntryOff");
    const rr = playRound(newTournament({ system: "roundRobin" }, 4));
    expectCode(() => d(rr, { type: "addPlayer", playerId: "l", name: "L" }), "lateEntryUnsupported");
  });
});

describe("validering: runder, parringer og resultater", () => {
  const paired = () => pairNextRound(newTournament({}, 4), meta());

  it("pairRound: feil rundenummer, forrige åpen, for få spillere, for mange runder", () => {
    let t = newTournament({}, 4);
    const { pairings } = nextRoundPairing(t);
    expectCode(() => d(t, { type: "pairRound", round: 2, pairings }), "roundWrongNumber");
    t = d(t, { type: "pairRound", round: 1, pairings });
    expectCode(() => d(t, { type: "pairRound", round: 2, pairings }), "roundPreviousOpen");
    expectCode(() => nextRoundPairing(newTournament({}, 1)), "notEnoughPlayers");
    let full = newTournament({ rounds: 1 }, 4);
    full = playRound(full);
    expectCode(() => nextRoundPairing(full), "roundTooMany");
  });
  it("pairRound validerer innholdet", () => {
    const t = newTournament({}, 4);
    const ok = nextRoundPairing(t).pairings;
    const pr = (pairings: typeof ok) => () => d(t, { type: "pairRound", round: 1, pairings });
    expectCode(pr([]), "pairingEmpty");
    expectCode(pr([ok[0], { ...ok[1], board: 1 }]), "pairingBoard");
    expectCode(pr([ok[0]]), "pairingMissingPlayer");
    expectCode(pr([ok[0], { board: 2, white: ok[0].white, black: ok[1].black }]), "pairingDuplicatePlayer");
    expectCode(pr([ok[0], { board: 2, white: "ukjent", black: ok[1].black }]), "pairingUnknownPlayer");
    const w = d(t, { type: "withdrawPlayer", playerId: ok[1].black! });
    expectCode(() => d(w, { type: "pairRound", round: 1, pairings: ok }), "pairingInactivePlayer");
  });
  it("pairRound må ta hensyn til ønsket bye", () => {
    let t = newTournament({}, 4);
    t = d(t, { type: "requestBye", playerId: "p1", round: 1, byeType: "half" });
    const { pairings } = nextRoundPairing(t);
    const bye = pairings.find((p) => p.black === null && p.white === "p1")!;
    expect(bye).toMatchObject({ white: "p1", byeType: "half" });
    const plain = newTournament({}, 4);
    expectCode(() => d(t, { type: "pairRound", round: 1, pairings: nextRoundPairing(plain).pairings }), "pairingByeRequest");
  });
  it("publish/result-livssyklus og låser", () => {
    let t = paired();
    expectCode(() => d(t, { type: "setResult", round: 1, board: 1, result: "1-0" }), "roundNotPublished");
    expectCode(() => d(t, { type: "completeRound", round: 1 }), "roundNotPublished");
    t = d(t, { type: "publishRound", round: 1 });
    expectCode(() => d(t, { type: "publishRound", round: 1 }), "roundNotDraft");
    expectCode(() => d(t, { type: "setResult", round: 1, board: 9, result: "1-0" }), "boardNotFound");
    expectCode(() => d(t, { type: "setResult", round: 1, board: 1, result: "2-0" as never }), "resultInvalid");
    expectCode(() => d(t, { type: "setResult", round: 7, board: 1, result: "1-0" }), "roundNotFound");
    expectCode(() => d(t, { type: "completeRound", round: 1 }), "resultsMissing");
    t = d(t, { type: "setResult", round: 1, board: 1, result: "½-½" });
    expect(t.rounds[0].pairings[0]).toMatchObject({ result: "½-½", resultSource: "arbiter" });
    t = d(t, { type: "clearResult", round: 1, board: 1 });
    expect(t.rounds[0].pairings[0].result).toBeNull();
    for (const p of t.rounds[0].pairings) t = d(t, { type: "setResult", round: 1, board: p.board, result: "+-" });
    t = d(t, { type: "completeRound", round: 1 });
    expectCode(() => d(t, { type: "setResult", round: 1, board: 1, result: "1-0" }), "roundCompleted");
    expectCode(() => d(t, { type: "clearResult", round: 1, board: 1 }), "roundCompleted");
    expectCode(() => d(t, { type: "completeRound", round: 1 }), "roundCompleted");
  });
  it("frirunde har ikke resultat", () => {
    let t = pairNextRound(newTournament({}, 3), meta());
    t = d(t, { type: "publishRound", round: 1 });
    const bye = t.rounds[0].pairings.find((p) => p.black === null)!;
    expectCode(() => d(t, { type: "setResult", round: 1, board: bye.board, result: "1-0" }), "resultOnBye");
    expectCode(() => d(t, { type: "clearResult", round: 1, board: bye.board }), "resultOnBye");
  });
  it("manualPairing og swapPairing: bare i utkast, markerer manual", () => {
    let t = paired();
    const [a, b] = t.rounds[0].pairings;
    t = d(t, { type: "swapPairing", round: 1, a: { board: a.board, side: "white" }, b: { board: b.board, side: "white" } });
    expect(t.rounds[0].pairings[0].white).toBe(b.white);
    expect(t.rounds[0].pairings[1].white).toBe(a.white);
    expect(t.rounds[0].pairings[0].manual).toBe(true);
    t = d(t, { type: "swapPairing", round: 1, a: { board: 1, side: "white" }, b: { board: 1, side: "black" } });
    expect(t.rounds[0].pairings[0].black).toBe(b.white);
    expectCode(() => d(t, { type: "swapPairing", round: 1, a: { board: 1, side: "white" }, b: { board: 1, side: "white" } }), "pairingBadSlot");
    expectCode(() => d(t, { type: "swapPairing", round: 1, a: { board: 1, side: "white" }, b: { board: 8, side: "white" } }), "boardNotFound");
    const mp = t.rounds[0].pairings.map((p) => ({ ...p }));
    t = d(t, { type: "manualPairing", round: 1, pairings: mp });
    expect(t.rounds[0].pairings.every((p) => p.manual)).toBe(true);
    t = d(t, { type: "publishRound", round: 1 });
    expectCode(() => d(t, { type: "manualPairing", round: 1, pairings: mp }), "roundNotDraft");
    expectCode(() => d(t, { type: "swapPairing", round: 1, a: { board: 1, side: "white" }, b: { board: 2, side: "white" } }), "roundNotDraft");
  });
  it("swap kan ikke flytte noen til tom bye-plass", () => {
    let t = pairNextRound(newTournament({}, 3), meta());
    const bye = t.rounds[0].pairings.find((p) => p.black === null)!;
    expectCode(() => d(t, { type: "swapPairing", round: 1, a: { board: bye.board, side: "black" }, b: { board: 1, side: "white" } }), "pairingBadSlot");
    t = d(t, { type: "swapPairing", round: 1, a: { board: bye.board, side: "white" }, b: { board: 1, side: "white" } });
    expect(t.rounds[0].pairings.find((p) => p.black === null)).toBeTruthy();
  });
  it("finishTournament: krever fullførte runder; låser videre hendelser; undo åpner igjen", () => {
    let t = newTournament({}, 4);
    expectCode(() => d(t, { type: "finishTournament" }), "nothingToFinish");
    t = pairNextRound(t, meta());
    expectCode(() => d(t, { type: "finishTournament" }), "roundsOpen");
    t = playRound(newTournament({ rounds: 1 }, 4));
    t = d(t, { type: "finishTournament" });
    expect(t.status).toBe("finished");
    expectCode(() => d(t, { type: "addPlayer", playerId: "z", name: "Z" }), "finished");
    expect(undo(t).status).toBe("running");
  });
});

describe("totalRounds", () => {
  it("utledes for alle-mot-alle og utslag", () => {
    expect(totalRounds(newTournament({ system: "roundRobin" }, 6))).toBe(5);
    expect(totalRounds(newTournament({ system: "roundRobin", doubleRoundRobin: true }, 6))).toBe(10);
    expect(totalRounds(newTournament({ system: "knockout" }, 6))).toBe(3);
    expect(totalRounds(newTournament({ system: "knockout" }, 8))).toBe(3);
    expect(totalRounds(newTournament({ system: "monrad", rounds: 4 }, 6))).toBe(4);
  });
});
