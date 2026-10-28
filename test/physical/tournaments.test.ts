import { describe, expect, it } from "vitest";
import { computeStandings } from "@/lib/tournament/tiebreaks";
import { dispatch, replay, totalRounds } from "@/lib/physical/reducer";
import { colourHistory, crosstable, historyOf, nextRoundPairing, pairNextRound, standings } from "@/lib/physical/selectors";
import type { PhysicalTournament } from "@/lib/physical/schema";
import { meta, newTournament, playRound } from "./helpers";

function activeOnceEachRound(t: PhysicalTournament) {
  for (const r of t.rounds) {
    const ids = r.pairings.flatMap((p) => [p.white, p.black]).filter(Boolean) as string[];
    expect(new Set(ids).size).toBe(ids.length);
  }
}

describe("Monrad 5 runder, 9 spillere (frirunder), helt gjennom reduceren", () => {
  let t = newTournament({ system: "monrad", rounds: 5 }, 9);
  for (let i = 0; i < 5; i++) t = playRound(t);
  t = dispatch(t, { type: "finishTournament" }, meta());

  it("fem fullførte runder, ingen dobbeltoppsett, ingen omkamper", () => {
    expect(t.rounds.map((r) => r.status)).toEqual(Array(5).fill("completed"));
    activeOnceEachRound(t);
    const seen = new Set<string>();
    for (const r of t.rounds)
      for (const p of r.pairings) {
        if (!p.black) continue;
        const k = [p.white, p.black].sort().join("|");
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
  });
  it("hver spiller får maks én automatisk frirunde (9 spillere, 5 runder)", () => {
    const byes = new Map<string, number>();
    for (const g of historyOf(t)) if (!g.black) byes.set(g.white, (byes.get(g.white) ?? 0) + 1);
    expect(byes.size).toBe(5);
    expect([...byes.values()].every((n) => n === 1)).toBe(true);
  });
  it("stilling = computeStandings med innstilte tiebreaks, og krysstabell-poeng stemmer", () => {
    const expected = computeStandings(
      t.players.map((p) => ({ id: p.id, rating: p.rating })),
      historyOf(t),
      t.settings.tiebreaks,
      5,
    );
    const got = standings(t);
    expect(got.map(({ player: _p, ...r }) => r)).toEqual(expected);
    const ct = crosstable(t);
    for (const row of ct) expect(row.score).toBe(got.find((g) => g.playerId === row.playerId)!.score);
    // sum poeng = antall partier (hvert parti deler ut 1 poeng) + frirunder
    expect(got.reduce((s, r) => s + r.score, 0)).toBe(5 * 4 + 5);
  });
  it("fargehistorikk har én oppføring per runde", () => {
    for (const arr of colourHistory(t).values()) expect(arr).toHaveLength(5);
  });
  it("replay gir samme sluttstate", () => {
    expect(replay(t.events)).toEqual(t);
  });
});

describe("Alle mot alle", () => {
  it("6 spillere: 5 runder, alle møter alle nøyaktig én gang, stilling riktig", () => {
    let t = newTournament({ system: "roundRobin" }, 6);
    expect(totalRounds(t)).toBe(5);
    for (let i = 0; i < 5; i++) t = playRound(t);
    const seen = new Map<string, number>();
    for (const g of historyOf(t)) {
      const k = [g.white, g.black].sort().join("|");
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect(seen.size).toBe(15);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    const s = standings(t);
    expect(s.map((r) => r.player.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(s.map((r) => r.score)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(() => nextRoundPairing(t)).toThrow();
  });
  it("5 spillere (odde) og dobbel serie: 10 runder", () => {
    let t = newTournament({ system: "roundRobin", doubleRoundRobin: true }, 5);
    expect(totalRounds(t)).toBe(10);
    for (let i = 0; i < 10; i++) t = playRound(t);
    activeOnceEachRound(t);
    const games = historyOf(t).filter((g) => g.black);
    expect(games).toHaveLength(20);
    const colours = new Map<string, number>();
    for (const g of games) {
      const k = `${g.white}>${g.black}`;
      colours.set(k, (colours.get(k) ?? 0) + 1);
    }
    expect(colours.size).toBe(20); // hver retning én gang
  });
  it("trekk midt i serien: motstanderne får walkover-poeng via frirunde", () => {
    let t = newTournament({ system: "roundRobin" }, 4);
    t = playRound(t);
    t = dispatch(t, { type: "withdrawPlayer", playerId: "p4" }, meta());
    t = playRound(t);
    t = playRound(t);
    const r2 = t.rounds[1].pairings;
    expect(r2.some((p) => p.white === "p4" || p.black === "p4")).toBe(false);
    expect(totalRounds(t)).toBe(3);
  });
});

describe("Utslag", () => {
  it("6 spillere: bye til topp-seed, 3 runder, én vinner", () => {
    let t = newTournament({ system: "knockout" }, 6);
    t = playRound(t);
    const r1 = t.rounds[0].pairings;
    expect(r1).toHaveLength(4);
    expect(r1.filter((p) => p.black === null).map((p) => p.white).sort()).toEqual(["p1", "p2"]);
    t = playRound(t);
    t = playRound(t);
    expect(t.rounds.map((r) => r.pairings.length)).toEqual([4, 2, 1]);
    const final = t.rounds[2].pairings[0];
    expect([final.white, final.black].sort()).toEqual(["p1", "p2"]);
    expect(standings(t)[0].player.id).toBe("p1");
    expect(() => nextRoundPairing(t)).toThrow();
    t = dispatch(t, { type: "finishTournament" }, meta());
    expect(t.status).toBe("finished");
  });
  it("uavgjort avvises, walkover avgjør, vinner går videre", () => {
    let t = newTournament({ system: "knockout" }, 4);
    t = pairNextRound(t, meta());
    t = dispatch(t, { type: "publishRound", round: 1 }, meta());
    expect(() => dispatch(t, { type: "setResult", round: 1, board: 1, result: "½-½" }, meta())).toThrow(/Uavgjort/);
    t = dispatch(t, { type: "setResult", round: 1, board: 1, result: "-+" }, meta()); // svart (p4) går videre
    t = dispatch(t, { type: "setResult", round: 1, board: 2, result: "1-0" }, meta());
    t = dispatch(t, { type: "completeRound", round: 1 }, meta());
    const next = nextRoundPairing(t).pairings;
    expect(next).toHaveLength(1);
    expect([next[0].white, next[0].black].sort()).toEqual(["p2", "p4"]);
  });
  it("2 spillere gir bare en finale", () => {
    const t = newTournament({ system: "knockout" }, 2);
    expect(totalRounds(t)).toBe(1);
    expect(nextRoundPairing(t).pairings).toHaveLength(1);
  });
});

describe("Sveitsisk", () => {
  it("4 runder, 10 spillere: alle spillere oppsatt hver runde", () => {
    let t = newTournament({ system: "swiss", rounds: 4 }, 10);
    for (let i = 0; i < 4; i++) t = playRound(t);
    activeOnceEachRound(t);
    expect(t.rounds.every((r) => r.pairings.length === 5)).toBe(true);
  });
  it("poeng for automatisk frirunde = ½ gir halv bye", () => {
    let t = newTournament({ system: "monrad", byePoints: 0.5 }, 5);
    t = pairNextRound(t, meta());
    expect(t.rounds[0].pairings.find((p) => p.black === null)?.byeType).toBe("half");
  });
});

describe("Trekk, sen påmelding og ønsket bye midt i turneringen", () => {
  it("trukket spiller parres ikke mer, men står i stillingen", () => {
    let t = newTournament({}, 8);
    t = playRound(t);
    t = dispatch(t, { type: "withdrawPlayer", playerId: "p3" }, meta());
    t = playRound(t);
    t = playRound(t);
    for (const r of t.rounds.slice(1)) expect(r.pairings.some((p) => p.white === "p3" || p.black === "p3")).toBe(false);
    const s = standings(t);
    expect(s.find((r) => r.playerId === "p3")).toBeTruthy();
    expect(s).toHaveLength(8);
    activeOnceEachRound(t);
  });
  it("trekk i en åpen runde: arrangør gir walkover og runden kan fullføres", () => {
    let t = pairNextRound(newTournament({}, 4), meta());
    const victim = t.rounds[0].pairings[0].white;
    t = dispatch(t, { type: "withdrawPlayer", playerId: victim }, meta());
    t = dispatch(t, { type: "publishRound", round: 1 }, meta());
    t = dispatch(t, { type: "setResult", round: 1, board: 1, result: "-+" }, meta());
    t = dispatch(t, { type: "setResult", round: 1, board: 2, result: "1-0" }, meta());
    t = dispatch(t, { type: "completeRound", round: 1 }, meta());
    expect(historyOf(t)[0]).toMatchObject({ forfeit: true, result: "0-1" });
    // forfeit teller ikke som «har møttes»: motstanderen kan parres igjen om nødvendig
    expect(nextRoundPairing(t).pairings.length).toBeGreaterThan(0);
  });
  it("senpåmeldt spiller kommer med fra neste runde", () => {
    let t = newTournament({}, 4);
    t = playRound(t);
    t = dispatch(t, { type: "addPlayer", playerId: "late1", name: "Sen Spiller", rating: 1500 }, meta());
    t = dispatch(t, { type: "addPlayer", playerId: "late2", name: "Sen To" }, meta());
    t = playRound(t);
    const ids = t.rounds[1].pairings.flatMap((p) => [p.white, p.black]);
    expect(ids).toContain("late1");
    expect(ids).toContain("late2");
    expect(t.rounds[1].pairings).toHaveLength(3);
    expect(t.players.find((p) => p.id === "late1")?.lateEntryRound).toBe(2);
    expect(standings(t)).toHaveLength(6);
  });
  it("ønsket halv bye gir ½ poeng, spilleren parres ikke den runden", () => {
    let t = newTournament({}, 6);
    t = dispatch(t, { type: "requestBye", playerId: "p1", round: 2, byeType: "half" }, meta());
    t = dispatch(t, { type: "requestBye", playerId: "p2", round: 2, byeType: "zero" }, meta());
    t = playRound(t);
    t = playRound(t);
    const byes = t.rounds[1].pairings.filter((p) => p.black === null);
    expect(byes.map((b) => [b.white, b.byeType]).sort()).toEqual([["p1", "half"], ["p2", "zero"]]);
    const s = standings(t);
    const ct = crosstable(t);
    expect(ct.find((r) => r.playerId === "p1")!.byePoints).toBe(0.5);
    expect(ct.find((r) => r.playerId === "p2")!.byePoints).toBe(0);
    expect(s.find((r) => r.playerId === "p1")!.score).toBe(1.5); // vant runde 1 + ½
    activeOnceEachRound(t);
  });
  it("angre etter trekk gjenoppretter spilleren i parringen", () => {
    let t = newTournament({}, 4);
    t = dispatch(t, { type: "withdrawPlayer", playerId: "p4" }, meta());
    expect(nextRoundPairing(t).pairings.some((p) => p.black === null)).toBe(true);
  });
});
