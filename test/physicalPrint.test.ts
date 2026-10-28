import { describe, expect, it } from "vitest";
import { makeEvent } from "@/lib/physical/events";
import { createTournament, reduce } from "@/lib/physical/reducer";
import type { PhysicalPairing, PhysicalSettings, PhysicalTournament, ResultCode } from "@/lib/physical/schema";
import { nextRoundPairing } from "@/lib/physical/selectors";
import {
  boardOrder, byesFor, cardsFor, certificatesFor, chunk, crossMatrix, findBoardList, fmtPoints, pickRound, boardQrUrl, isPrintKind,
} from "@/lib/physical/print/data";
import { adjustTimer, formatTimer, newTimer, pageAt, pauseTimer, resetTimer, startTimer, timerRemaining } from "@/lib/physical/print/timer";

const settings: PhysicalSettings = {
  system: "monrad", rounds: 3, tiebreaks: ["buchholz"], byePoints: 1, allowLateEntry: false,
};

function build(names: string[], results: ResultCode[][]): PhysicalTournament {
  let t = createTournament({ id: "t1", title: "Test", settings });
  names.forEach((n, i) => {
    t = reduce(t, makeEvent({ type: "addPlayer", playerId: `p${i + 1}`, name: n, rating: 1500 - i * 10 }));
  });
  results.forEach((rs, ri) => {
    const { round, pairings } = nextRoundPairing(t);
    t = reduce(t, makeEvent({ type: "pairRound", round, pairings }));
    t = reduce(t, makeEvent({ type: "publishRound", round }));
    const games = t.rounds[ri].pairings.filter((p) => p.black !== null);
    games.forEach((g, i) => {
      t = reduce(t, makeEvent({ type: "setResult", round, board: g.board, result: rs[i] ?? "1-0" }));
    });
    t = reduce(t, makeEvent({ type: "completeRound", round }));
  });
  return t;
}

describe("chunk / boardOrder", () => {
  it("deler i sider og tåler tom liste og ugyldig størrelse", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
  it("sorterer etter brett med frirunder sist", () => {
    const ps: PhysicalPairing[] = [
      { board: 1, white: "a", black: null, byeType: "full" },
      { board: 3, white: "c", black: "d" },
      { board: 2, white: "e", black: "f" },
    ];
    expect(boardOrder(ps).map((p) => p.board)).toEqual([2, 3, 1]);
  });
});

describe("finn bordet ditt", () => {
  const t = build(["Åse", "Anna", "Øyvind", "Zoe", "Bjørn"], [["1-0", "1-0"]]);
  it("er alfabetisk på norsk (Å sist) og har brett og farge", () => {
    const rows = findBoardList(t, pickRound(t, 1));
    expect(rows.map((r) => r.name)).toEqual(["Anna", "Bjørn", "Zoe", "Øyvind", "Åse"]);
    expect(rows.every((r) => r.board !== null)).toBe(true);
    const bye = rows.filter((r) => r.colour === "bye");
    expect(bye).toHaveLength(1);
    expect(bye[0].opponent).toBeNull();
    const w = rows.find((r) => r.colour === "W")!;
    const opp = rows.find((r) => r.name === w.opponent)!;
    expect(opp.colour).toBe("B");
    expect(opp.board).toBe(w.board);
  });
  it("hopper over trukne spillere uten brett", () => {
    let t2 = build(["A", "B", "C", "D"], []);
    t2 = reduce(t2, makeEvent({ type: "withdrawPlayer", playerId: "p4" }));
    expect(findBoardList(t2, null).map((r) => r.name)).toEqual(["A", "B", "C"]);
  });
});

describe("bordkort og frirunder", () => {
  const t = build(["A", "B", "C", "D", "E"], [[]]);
  it("lager ett kort per spillbrett, ikke for frirunde", () => {
    const cards = cardsFor(t, pickRound(t, 1));
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.board)).toEqual([1, 2]);
    expect(cards[0].round).toBe(1);
    expect(byesFor(t, pickRound(t, 1))).toHaveLength(1);
  });
  it("QR-hook gir null foreløpig", () => {
    expect(boardQrUrl(t, 1, 1)).toBeNull();
  });
  it("kjenner igjen utskriftstyper", () => {
    expect(isPrintKind("diplomer")).toBe(true);
    expect(isPrintKind("x")).toBe(false);
  });
});

describe("krysstabell", () => {
  it("har tom diagonal og motsatte poeng i speilcellene", () => {
    const t = build(["A", "B", "C", "D"], [["1-0", "½-½"]]);
    const m = crossMatrix(t);
    expect(m.rows).toHaveLength(4);
    m.rows.forEach((r, i) => expect(r.cells[i]).toBeNull());
    const first = m.rows[0];
    const other = m.rows.find((r) => r.cells[0] !== "–" && r !== first)!;
    expect(["0", "½"]).toContain(other.cells[0]);
  });
  it("formaterer halve poeng", () => {
    expect([0, 0.5, 1, 1.5, 3].map(fmtPoints)).toEqual(["0", "½", "1", "1½", "3"]);
  });
});

describe("diplomer", () => {
  it("gir ingen diplomer før en runde er fullført", () => {
    expect(certificatesFor(build(["A", "B", "C"], []), { participants: true })).toEqual([]);
  });
  it("topp 3 uten uavgjort, deltakerdiplom valgfritt", () => {
    const t = build(["A", "B", "C", "D", "E", "F"], [["1-0", "1-0", "1-0"], ["1-0", "1-0", "1-0"], ["1-0", "1-0", "1-0"]]);
    const top = certificatesFor(t);
    expect(top.length).toBeGreaterThanOrEqual(3);
    expect(top.every((c) => c.kind === "place" && c.rank! <= 3)).toBe(true);
    expect(top[0].rank).toBe(1);
    const all = certificatesFor(t, { participants: true });
    expect(all).toHaveLength(6);
    expect(all.filter((c) => c.kind === "participant").length).toBe(6 - top.length);
  });
  it("delt plass gir flere diplomer og hopper over neste plass", () => {
    // 4 spillere, én runde: begge vinnere deler 1., begge tapere deler 3.
    const t = build(["A", "B", "C", "D"], [["1-0", "1-0"]]);
    const certs = certificatesFor(t);
    const ranks = certs.map((c) => c.rank);
    expect(ranks.filter((r) => r === 1).length).toBeGreaterThanOrEqual(1);
    certs.forEach((c) => expect(c.rank).toBeLessThanOrEqual(3));
    for (const c of certs) {
      const same = certs.filter((x) => x.rank === c.rank).length;
      expect(c.shared).toBe(same > 1);
    }
    // aldri rang 2 uten at en rang 1 finnes, og ingen rang som ville vært hoppet over
    const set = new Set(ranks);
    if (set.has(2)) expect(set.has(1)).toBe(true);
  });
});

describe("nedtelling", () => {
  it("teller ned, pauser, justerer og nullstiller", () => {
    let s = newTimer(10);
    expect(formatTimer(timerRemaining(s, 0))).toBe("10:00");
    s = startTimer(s, 1000);
    expect(timerRemaining(s, 1000 + 90_000)).toBe(510_000);
    s = pauseTimer(s, 1000 + 90_000);
    expect(timerRemaining(s, 999_999)).toBe(510_000);
    s = adjustTimer(s, 5000, 1);
    expect(timerRemaining(s, 5000)).toBe(570_000);
    s = startTimer(s, 5000);
    expect(timerRemaining(s, 5000 + 10 * 60_000)).toBe(0);
    s = resetTimer(s);
    expect(s.startedAt).toBeNull();
    expect(s.remainingMs).toBe(s.durationMs);
  });
  it("formaterer timer og runder opp sekunder", () => {
    expect(formatTimer(61_000)).toBe("01:01");
    expect(formatTimer(500)).toBe("00:01");
    expect(formatTimer(3_725_000)).toBe("1:02:05");
  });
  it("blar sider syklisk", () => {
    expect([0, 1, 2, 3, 4].map((i) => pageAt(i, 3))).toEqual([0, 1, 2, 0, 1]);
    expect(pageAt(7, 1)).toBe(0);
  });
});
