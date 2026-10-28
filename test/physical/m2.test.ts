import { describe, expect, it } from "vitest";
import { PhysicalError, type PhysicalErrorCode } from "@/lib/physical/errors";
import { canUndo, dispatch, replay, undo } from "@/lib/physical/reducer";
import { crosstableByRound, describeEvent, nextMissingBoard, resultForKey, roundProgress, withdrawImpact } from "@/lib/physical/roundView";
import { createSaveQueue } from "@/lib/physical/saveQueue";
import type { PhysicalEventBody, PhysicalTournament, StoredTournament } from "@/lib/physical/schema";
import { crosstable, historyOf, pairNextRound, standings } from "@/lib/physical/selectors";
import { memoryStore, type PhysicalStore } from "@/lib/physical/storage";
import { meta, newTournament, playRound } from "./helpers";

const d = (t: PhysicalTournament, b: PhysicalEventBody) => dispatch(t, b, meta());
function expectCode(fn: () => unknown, code: PhysicalErrorCode) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PhysicalError);
    expect((e as PhysicalError).code).toBe(code);
    return;
  }
  throw new Error(`forventet feil ${code}`);
}
/** Par og publiser runde n. */
function published(t: PhysicalTournament, autoForfeit = false) {
  t = pairNextRound(t, meta());
  return d(t, { type: "publishRound", round: t.rounds.length, ...(autoForfeit ? { autoForfeit } : {}) });
}
const game = (t: PhysicalTournament, board: number, round = t.rounds.length) =>
  t.rounds.find((r) => r.number === round)!.pairings.find((p) => p.board === board)!;

describe("withdrawPlayer med forfeit", () => {
  it("hvit trukket → svart vinner (-+); svart trukket → +-", () => {
    let t = published(newTournament({}, 4));
    const g1 = game(t, 1);
    const g2 = game(t, 2);
    t = d(t, { type: "withdrawPlayer", playerId: g1.white, forfeit: true });
    t = d(t, { type: "withdrawPlayer", playerId: g2.black as string, forfeit: true });
    expect(game(t, 1).result).toBe("-+");
    expect(game(t, 2).result).toBe("+-");
    expect(game(t, 1).resultSource).toBe("arbiter");
  });
  it("lar ferdige partier stå og er atomisk å angre (én hendelse)", () => {
    let t = published(newTournament({}, 4));
    const g1 = game(t, 1);
    t = d(t, { type: "setResult", round: 1, board: 1, result: "½-½" });
    const before = t;
    t = d(t, { type: "withdrawPlayer", playerId: g1.white, forfeit: true });
    expect(game(t, 1).result).toBe("½-½");
    expect(canUndo(t)).toBe(true);
    expect(undo(t)).toEqual(before);
    expect(replay(t.events)).toEqual(t);
  });
  it("uten forfeit-flagget er oppførselen som før", () => {
    let t = published(newTournament({}, 4));
    t = d(t, { type: "withdrawPlayer", playerId: game(t, 1).white });
    expect(game(t, 1).result ?? null).toBeNull();
  });
  it("begge trukket → '=' (ikke i utslag)", () => {
    let t = published(newTournament({}, 4));
    const g = game(t, 1);
    t = d(t, { type: "withdrawPlayer", playerId: g.white });
    t = d(t, { type: "withdrawPlayer", playerId: g.black as string, forfeit: true });
    expect(game(t, 1).result).toBe("=");
    let k = published(newTournament({ system: "knockout" }, 4));
    const kg = game(k, 1);
    k = d(k, { type: "withdrawPlayer", playerId: kg.white });
    k = d(k, { type: "withdrawPlayer", playerId: kg.black as string, forfeit: true });
    expect(game(k, 1).result ?? null).toBeNull();
  });
  it("utkast røres ikke; publishRound med autoForfeit setter walkover", () => {
    let t = pairNextRound(newTournament({}, 4), meta());
    const w = game(t, 1).white;
    t = d(t, { type: "withdrawPlayer", playerId: w, forfeit: true });
    expect(game(t, 1).result ?? null).toBeNull();
    expect(withdrawImpact(newTournament({}, 4), "p1").inDraft).toBe(false);
    const draftImpact = withdrawImpact(pairNextRound(newTournament({}, 4), meta()), "p1");
    expect(draftImpact.inDraft).toBe(true);
    t = d(t, { type: "publishRound", round: 1, autoForfeit: true });
    expect(game(t, 1).result).toBe("-+");
  });
  it("withdrawImpact forhåndsviser walkover", () => {
    const t = published(newTournament({}, 4));
    const g = game(t, 2);
    const imp = withdrawImpact(t, g.black as string);
    expect(imp.forfeits).toEqual([{ board: 2, result: "+-", opponentId: g.white }]);
  });
  it("trukket spiller får 0 og turneringen kan fullføres", () => {
    let t = published(newTournament({}, 4));
    const g = game(t, 1);
    t = d(t, { type: "withdrawPlayer", playerId: g.white, forfeit: true });
    t = d(t, { type: "setResult", round: 1, board: 2, result: "1-0" });
    t = d(t, { type: "completeRound", round: 1 });
    expect(standings(t).find((r) => r.playerId === g.white)!.score).toBe(0);
    t = pairNextRound(t, meta());
    expect(t.rounds[1].pairings.some((p) => p.white === g.white || p.black === g.white)).toBe(false);
  });
});

describe("sen påmelding med ½ poeng for tapte runder", () => {
  function twoRounds() {
    let t = newTournament({ rounds: 5 }, 6);
    t = playRound(t);
    t = playRound(t);
    return t;
  }
  it("standard 0 poeng", () => {
    let t = twoRounds();
    t = d(t, { type: "addPlayer", playerId: "late", name: "Sen" });
    expect(t.players.find((p) => p.id === "late")!.missedRoundPoints).toBeUndefined();
    expect(standings(t).find((r) => r.playerId === "late")!.score).toBe(0);
  });
  it("½ per tapt runde i stilling, krysstabell og historikk; parres videre", () => {
    let t = twoRounds();
    t = d(t, { type: "addPlayer", playerId: "late", name: "Sen", missedRoundPoints: 0.5 });
    expect(t.players.find((p) => p.id === "late")!.lateEntryRound).toBe(3);
    expect(standings(t).find((r) => r.playerId === "late")!.score).toBe(1);
    expect(crosstable(t).find((r) => r.playerId === "late")!.score).toBe(1);
    expect(historyOf(t).filter((g) => g.white === "late")).toHaveLength(2);
    const x = crosstableByRound(t).rows.find((r) => r.player.id === "late")!;
    expect(x.cells.map((c) => [c.kind, c.points])).toEqual([["missed", 0.5], ["missed", 0.5]]);
    t = playRound(t);
    expect(standings(t).find((r) => r.playerId === "late")!.score).toBeGreaterThanOrEqual(1);
    expect(replay(t.events)).toEqual(t);
  });
  it("ugyldig verdi avvises; før runde 1 ignoreres", () => {
    const t = twoRounds();
    expectCode(() => d(t, { type: "addPlayer", playerId: "x", name: "X", missedRoundPoints: 1 as 0 }), "badEvent");
    const t0 = d(newTournament({}, 3), { type: "addPlayer", playerId: "x", name: "X", missedRoundPoints: 0.5 });
    expect(t0.players[3].missedRoundPoints).toBeUndefined();
  });
});

describe("endring av parring etter publisering", () => {
  it("krever afterPublish og nullstiller berørte resultater", () => {
    let t = published(newTournament({}, 4));
    t = d(t, { type: "setResult", round: 1, board: 1, result: "1-0" });
    t = d(t, { type: "setResult", round: 1, board: 2, result: "0-1" });
    const swap = (afterPublish?: boolean): PhysicalEventBody => ({
      type: "swapPairing",
      round: 1,
      a: { board: 1, side: "black" },
      b: { board: 2, side: "white" },
      ...(afterPublish ? { afterPublish } : {}),
    });
    expectCode(() => d(t, swap()), "roundNotDraft");
    const before1 = game(t, 1);
    const before2 = game(t, 2);
    t = d(t, swap(true));
    expect(game(t, 1).white).toBe(before1.white);
    expect(game(t, 1).black).toBe(before2.white);
    expect(game(t, 1).result).toBeNull();
    expect(game(t, 2).result).toBeNull();
    expect(replay(t.events)).toEqual(t);
  });
  it("manualPairing etter publisering beholder uendrede resultater; fullført runde er låst", () => {
    let t = published(newTournament({}, 4));
    t = d(t, { type: "setResult", round: 1, board: 1, result: "1-0" });
    const g1 = game(t, 1);
    const g2 = game(t, 2);
    expectCode(() => d(t, { type: "manualPairing", round: 1, pairings: t.rounds[0].pairings }), "roundNotDraft");
    t = d(t, {
      type: "manualPairing",
      round: 1,
      afterPublish: true,
      pairings: [
        { board: 1, white: g1.white, black: g1.black },
        { board: 2, white: g2.black as string, black: g2.white },
      ],
    });
    expect(game(t, 1).result).toBe("1-0");
    expect(game(t, 2).result).toBeNull();
    t = d(t, { type: "setResult", round: 1, board: 2, result: "1-0" });
    t = d(t, { type: "completeRound", round: 1 });
    expectCode(() => d(t, { type: "swapPairing", round: 1, afterPublish: true, a: { board: 1, side: "white" }, b: { board: 2, side: "white" } }), "roundCompleted");
  });
});

describe("roundView", () => {
  it("fremdrift, neste brett, tastatur", () => {
    let t = published(newTournament({}, 5));
    const r = () => t.rounds[0];
    expect(roundProgress(r())).toMatchObject({ total: 2, done: 0, missing: [1, 2] });
    t = d(t, { type: "setResult", round: 1, board: 1, result: "1-0" });
    expect(roundProgress(r())).toMatchObject({ done: 1, missing: [2] });
    expect(nextMissingBoard(r(), 1)).toBe(2);
    expect(nextMissingBoard(r(), 2)).toBe(2);
    t = d(t, { type: "setResult", round: 1, board: 2, result: "1-0" });
    expect(nextMissingBoard(r(), 1)).toBeNull();
    expect(resultForKey("1", false)).toBe("1-0");
    expect(resultForKey("0", false)).toBe("0-1");
    expect(resultForKey("=", false)).toBe("½-½");
    expect(resultForKey("h", false)).toBe("½-½");
    expect(resultForKey("h", true)).toBeNull();
    expect(resultForKey("Backspace", false)).toBe("clear");
    expect(resultForKey("q", false)).toBeNull();
  });
  it("krysstabell per runde: motstander, farge, poeng, frirunde", () => {
    let t = newTournament({}, 5);
    t = playRound(t);
    const x = crosstableByRound(t);
    expect(x.rounds).toEqual([1]);
    const bye = x.rows.find((r) => r.cells[0].kind === "bye")!;
    expect(bye.cells[0].points).toBe(1);
    const gameRow = x.rows.find((r) => r.cells[0].kind === "game")!;
    expect(gameRow.cells[0].opp).toBeGreaterThan(0);
    expect(["W", "B"]).toContain(gameRow.cells[0].colour);
  });
  it("toast-tekst for hendelser", () => {
    let t = published(newTournament({}, 4));
    t = d(t, { type: "setResult", round: 1, board: 1, result: "1-0" });
    expect(describeEvent(t, t.events[t.events.length - 1])).toMatch(/Brett 1: .* – .* 1–0/);
    t = d(t, { type: "withdrawPlayer", playerId: "p1", forfeit: true });
    expect(describeEvent(t, t.events[t.events.length - 1])).toMatch(/walkover/);
  });
});

describe("saveQueue", () => {
  function slowStore(delay: number) {
    const mem = memoryStore();
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const store: PhysicalStore = {
      ...mem,
      put: async (rec: StoredTournament) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, delay));
        await mem.put(rec);
        log.push(String(rec.events.length));
        active--;
      },
    };
    return { store, mem, log, maxActive: () => maxActive };
  }
  it("serialiserer skrivinger og slår sammen ventende tilstander; siste vinner", async () => {
    const { store, mem, log, maxActive } = slowStore(15);
    const states: string[] = [];
    const q = createSaveQueue(async () => store, (s) => states.push(s));
    let t = newTournament({}, 4);
    q.enqueue(t);
    t = d(t, { type: "addPlayer", playerId: "a", name: "A" });
    q.enqueue(t);
    t = d(t, { type: "addPlayer", playerId: "b", name: "B" });
    q.enqueue(t);
    expect(q.state).toBe("saving");
    await q.idle();
    expect(maxActive()).toBe(1);
    expect(log).toEqual([String(t.events.length - 2), String(t.events.length)]);
    expect((await mem.get(t.id))!.events).toHaveLength(t.events.length);
    expect(q.state).toBe("saved");
    expect(states[0]).toBe("saving");
  });
  it("flush starter ventende skriving med en gang", async () => {
    const { store, mem } = slowStore(20);
    const q = createSaveQueue(async () => store);
    let t = newTournament({}, 3);
    q.enqueue(t);
    t = d(t, { type: "addPlayer", playerId: "a", name: "A" });
    q.enqueue(t);
    await q.flush();
    expect((await mem.get(t.id))!.events).toHaveLength(t.events.length);
  });
  it("feil i lagring gir tilstand 'failed' uten å kaste", async () => {
    const store: PhysicalStore = { ...memoryStore(), put: async () => Promise.reject(new Error("full")) };
    const q = createSaveQueue(async () => store);
    q.enqueue(newTournament({}, 2));
    await q.idle();
    expect(q.state).toBe("failed");
  });
});
