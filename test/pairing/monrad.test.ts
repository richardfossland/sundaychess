import { describe, expect, it } from "vitest";
import {
  allocateColours,
  byeCandidates,
  colourConflict,
  colourStatesFromHistory,
  monrad,
  pairKey,
  requiredColour,
  type HistoryGame,
  type PairingPlayer,
} from "@/lib/tournament/pairing";
import { mk, mulberry32, scoresFrom, toHistory } from "./helpers";

const g = (round: number, white: string, black: string | null, result: HistoryGame["result"], byeType?: HistoryGame["byeType"]): HistoryGame => ({
  round, white, black, result, ...(byeType ? { byeType } : {}),
});

function withScores(n: number, history: HistoryGame[]): PairingPlayer[] {
  const s = scoresFrom(mk(n).map((p) => p.id), history);
  return mk(n).map((p) => ({ ...p, score: s.get(p.id) ?? 0 }));
}

const view = (o: ReturnType<typeof monrad>) =>
  o.pairings.map((p) => `${p.white}-${p.black ?? "bye"}${p.byeType ? `:${p.byeType}` : ""}`);

describe("golden: Monrad", () => {
  it("round 1: 1v2, 3v4 …, hi seed white", () => {
    expect(view(monrad({ players: mk(6), history: [], round: 1 }))).toEqual(["p1-p2", "p3-p4", "p5-p6"]);
  });

  it("round 1 odd: last start number gets the bye", () => {
    expect(view(monrad({ players: mk(5), history: [], round: 1 }))).toEqual(["p1-p2", "p3-p4", "p5-bye:full"]);
  });

  it("round 2: winners meet, losers meet, colours swap on conflict", () => {
    const history = [g(1, "p1", "p2", "1-0"), g(1, "p3", "p4", "1-0"), g(1, "p5", "p6", "1-0"), g(1, "p7", "p8", "1-0")];
    const out = monrad({ players: withScores(8, history), history, round: 2 });
    // order: p1 p3 p5 p7 | p2 p4 p6 p8 ; all winners had white → hi gets black, losers had black → hi gets white
    expect(view(out)).toEqual(["p3-p1", "p7-p5", "p2-p4", "p6-p8"]);
  });

  it("floats down past a repeat opponent", () => {
    // p1 already played p3; p1 must go to p5, p3 to p7 — wait, p1v3 are both 1 pt.
    const history = [g(1, "p1", "p3", "1-0"), g(1, "p2", "p4", "0-1"), g(1, "p5", "p6", "1-0"), g(1, "p7", "p8", "1-0")];
    const ps = withScores(8, history); // winners: p1,p4,p5,p7
    const out = monrad({ players: ps, history, round: 2 });
    const keys = out.pairings.map((p) => pairKey(p.white, p.black!));
    expect(keys).not.toContain(pairKey("p1", "p3"));
    expect(out.pairings.every((p) => !p.rematch)).toBe(true);
    // winners p1,p4,p5,p7 pair among themselves: p1-p4, p5-p7
    expect(keys).toContain(pairKey("p1", "p4"));
    expect(keys).toContain(pairKey("p5", "p7"));
  });

  it("score groups odd: lowest of upper group floats into the next", () => {
    const history = [g(1, "p1", "p2", "1-0"), g(1, "p3", "p4", "1-0"), g(1, "p5", "p6", "1-0")];
    const out = monrad({ players: withScores(6, history), history, round: 2 });
    // order p1 p3 p5 p2 p4 p6 → p1-p3, p5-p2, p4-p6
    expect(out.pairings.map((p) => pairKey(p.white, p.black!))).toEqual([
      pairKey("p1", "p3"), pairKey("p5", "p2"), pairKey("p4", "p6"),
    ]);
  });

  it("bye goes to lowest-ranked without a previous bye", () => {
    const history = [g(1, "p5", null, "bye", "full"), g(1, "p1", "p2", "1-0"), g(1, "p3", "p4", "1-0")];
    const out = monrad({ players: withScores(5, history), history, round: 2 });
    const bye = out.pairings.find((p) => p.black === null)!;
    expect(bye.white).toBe("p4"); // p5 had one; p4 is next lowest (score 0)
    expect(bye.byeType).toBe("full");
  });

  it("requested half/zero byes are excluded from pairing", () => {
    const ps = mk(6);
    ps[1].byeRequest = "half";
    ps[4].byeRequest = "zero";
    const out = monrad({ players: ps, history: [], round: 1 });
    expect(view(out)).toEqual(["p1-p3", "p4-p6", "p2-bye:half", "p5-bye:zero"]);
  });

  it("withdrawn and absent players are not paired", () => {
    const ps = mk(6);
    ps[0].status = "withdrawn";
    ps[1].status = "absent";
    expect(view(monrad({ players: ps, history: [], round: 1 }))).toEqual(["p3-p4", "p5-p6"]);
  });

  it("skips a bye candidate that would force a repeat", () => {
    // 3 players, all met pairwise except p1-p3 … p3 (lowest) bye would leave p1-p2 (met)
    const history = [g(1, "p1", "p2", "1/2-1/2")];
    const ps = withScores(3, history);
    const out = monrad({ players: ps, history, round: 2 });
    expect(out.pairings.every((p) => !p.rematch)).toBe(true);
    expect(out.pairings.find((p) => p.black === null)!.white).not.toBe("p3");
  });

  it("flags a forced rematch when every pair has met", () => {
    const history = [g(1, "p1", "p2", "1-0"), g(1, "p3", "p4", "1-0"), g(2, "p1", "p3", "1-0"), g(2, "p2", "p4", "1-0"), g(3, "p1", "p4", "1-0"), g(3, "p2", "p3", "1-0")];
    const out = monrad({ players: withScores(4, history), history, round: 4 });
    expect(out.pairings).toHaveLength(2);
    expect(out.pairings.some((p) => p.rematch)).toBe(true);
  });
});

describe("colours", () => {
  it("never gives a third same colour in a row when avoidable", () => {
    const history = [g(1, "a", "x", "1-0"), g(2, "a", "y", "1-0")]; // a: W W
    const st = colourStatesFromHistory(history);
    expect(requiredColour(st.get("a")!)).toBe("B");
    const r = allocateColours("a", "z", st.get("a"), st.get("z"));
    expect(r.black).toBe("a");
  });

  it("diff +2 forces black, -2 forces white", () => {
    const st = colourStatesFromHistory([g(1, "a", "x", "1-0"), g(2, "y", "a", "1-0"), g(3, "a", "z", "1-0"), g(4, "a", "w", "1-0")]);
    // a: W B W W → run 2 → must be black
    expect(requiredColour(st.get("a")!)).toBe("B");
    expect(requiredColour(st.get("x")!)).toBe(null);
  });

  it("higher-ranked wins equal-strength conflicts; alternates by default", () => {
    const st = colourStatesFromHistory([g(1, "a", "x", "1-0"), g(1, "b", "y", "1-0")]);
    // a and b both had white: both prefer black → hi (a) black
    expect(allocateColours("a", "b", st.get("a"), st.get("b"))).toEqual({ white: "b", black: "a" });
    expect(allocateColours("a", "b")).toEqual({ white: "a", black: "b" });
  });

  it("detects an impossible colour pair", () => {
    const st = colourStatesFromHistory([g(1, "a", "x", "1-0"), g(2, "a", "y", "1-0"), g(1, "b", "z", "1-0"), g(2, "b", "w", "1-0")]);
    expect(colourConflict(st.get("a")!, st.get("b")!)).toBe(true);
  });

  it("matching dodges a colour-impossible pair when another opponent exists", () => {
    // a,b both W W; c,d both balanced. Equal scores. a-b would be impossible → a-c, b-d
    const history = [g(1, "a", "x", "1-0"), g(2, "a", "y", "1-0"), g(1, "b", "z", "1-0"), g(2, "b", "w", "1-0")];
    const ps: PairingPlayer[] = ["a", "b", "c", "d"].map((id, i) => ({ id, startNo: i + 1, score: 1, status: "active" as const }));
    const out = monrad({ players: ps, history, round: 3 });
    expect(out.pairings.map((p) => pairKey(p.white, p.black!))).not.toContain(pairKey("a", "b"));
    for (const p of out.pairings) {
      expect([p.white, p.black]).not.toContain(undefined);
    }
    const aGame = out.pairings.find((p) => p.white === "a" || p.black === "a")!;
    expect(aGame.black).toBe("a");
  });
});

describe("byeCandidates", () => {
  it("returns only the fewest-byes tier, lowest-ranked first", () => {
    const ranked = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(byeCandidates(ranked, new Map([["d", 1]]))).toEqual(["c", "b", "a"]);
  });
});

describe("property: random tournaments", () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}`, () => {
      const rng = mulberry32(seed);
      const n = 2 + Math.floor(rng() * 24);
      const rounds = 1 + Math.floor(rng() * Math.min(7, n));
      const players = mk(n);
      let history: HistoryGame[] = [];
      for (let round = 1; round <= rounds; round++) {
        // random lifecycle events
        if (round > 1 && rng() < 0.25) {
          const act = players.filter((p) => p.status === "active");
          if (act.length > 3) act[Math.floor(rng() * act.length)].status = "withdrawn";
        }
        for (const p of players) {
          p.byeRequest = p.status === "active" && rng() < 0.08 ? (rng() < 0.5 ? "half" : "zero") : undefined;
        }
        const sc = scoresFrom(players.map((p) => p.id), history);
        const cur = players.map((p) => ({ ...p, score: sc.get(p.id) ?? 0 }));
        const input = { players: cur, history, round };
        const out = monrad(input);

        // determinism + purity
        expect(monrad(input)).toEqual(out);

        // each active player exactly once; inactive never
        const seen = new Map<string, number>();
        for (const p of out.pairings) {
          seen.set(p.white, (seen.get(p.white) ?? 0) + 1);
          if (p.black) seen.set(p.black, (seen.get(p.black) ?? 0) + 1);
        }
        for (const p of cur) expect(seen.get(p.id) ?? 0).toBe(p.status === "active" ? 1 : 0);

        // boards 1..k contiguous, byes last
        out.pairings.forEach((p, i) => expect(p.board).toBe(i + 1));
        const firstBye = out.pairings.findIndex((p) => p.black === null);
        if (firstBye >= 0) expect(out.pairings.slice(firstBye).every((p) => p.black === null)).toBe(true);

        // requested byes honoured; at most one automatic bye
        for (const p of cur.filter((x) => x.status === "active" && x.byeRequest)) {
          expect(out.pairings.find((x) => x.white === p.id)).toMatchObject({ black: null, byeType: p.byeRequest });
        }
        expect(out.pairings.filter((p) => p.byeType === "full").length).toBeLessThanOrEqual(1);

        // no repeats unless flagged
        const met = new Set(history.filter((h) => h.black).map((h) => pairKey(h.white, h.black!)));
        for (const p of out.pairings) {
          if (p.black && met.has(pairKey(p.white, p.black))) expect(p.rematch).toBe(true);
        }

        // while a repeat-free option plausibly exists (rounds < n-1, nobody removed) no flag
        if (round < Math.floor(n / 2) && players.every((p) => p.status === "active")) {
          expect(out.pairings.some((p) => p.rematch)).toBe(false);
        }

        history = history.concat(toHistory(round, out, rng));
      }
    });
  }
});

describe("property: colour constraints over whole tournaments", () => {
  it("max run ≤ 2 and |diff| ≤ 2 in nearly all games; hard violations only when forced", () => {
    let games = 0;
    let violations = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const rng = mulberry32(seed * 7919);
      const n = 6 + 2 * Math.floor(rng() * 10); // even, no automatic byes
      const players = mk(n);
      let history: HistoryGame[] = [];
      for (let round = 1; round <= 5; round++) {
        const sc = scoresFrom(players.map((p) => p.id), history);
        const cur = players.map((p) => ({ ...p, score: sc.get(p.id) ?? 0 }));
        const before = colourStatesFromHistory(history);
        const out = monrad({ players: cur, history, round });
        for (const p of out.pairings) {
          games += 2;
          const w = before.get(p.white), b = before.get(p.black!);
          if (w && (w.run >= 2 && w.last === "W" || w.diff >= 2)) violations++;
          if (b && (b.run >= 2 && b.last === "B" || b.diff <= -2)) violations++;
        }
        history = history.concat(toHistory(round, out, rng));
      }
    }
    expect(violations / games).toBeLessThan(0.01);
  });
});

describe("unplayed (forfeit) games", () => {
  it("a forfeit is not a meeting: those two may be paired again, no rematch flag", () => {
    const history: HistoryGame[] = [{ ...g(1, "p1", "p2", "1-0"), forfeit: true }];
    const out = monrad({ players: withScores(2, history), history, round: 2 });
    expect(view(out)).toEqual(["p1-p2"]);
    expect(out.pairings[0].rematch).toBeUndefined();
    // …whereas a PLAYED game is a meeting
    const played = monrad({ players: withScores(2, [g(1, "p1", "p2", "1-0")]), history: [g(1, "p1", "p2", "1-0")], round: 2 });
    expect(played.pairings[0].rematch).toBe(true);
  });

  it("a forfeit carries no colour (colour state ignores it)", () => {
    const st = colourStatesFromHistory([
      { ...g(1, "p1", "p2", "1-0"), forfeit: true },
      g(2, "p1", "p3", "1-0"),
    ]);
    expect(st.get("p1")).toEqual({ diff: 1, last: "W", run: 1 });
    expect(st.get("p2")).toBeUndefined();
  });
});

describe("node budget", () => {
  it("reports relaxed: 'budget' when the search is cut short, and not otherwise", () => {
    // 24 players: A (21, mutually fresh) and B (3, mutually fresh); every A–B pair
    // already met → no perfect matching exists and the backtracking blows the budget.
    const ids = Array.from({ length: 24 }, (_, i) => `p${i + 1}`);
    const A = ids.slice(0, 21);
    const B = ids.slice(21);
    const history: HistoryGame[] = [];
    A.forEach((a) => B.forEach((b) => history.push(g(1, a, b, "1/2-1/2"))));
    const out = monrad({ players: mk(24), history, round: 2 });
    expect(out.relaxed).toBe("budget");
    expect(out.pairings).toHaveLength(12); // still produces a pairing
    expect(monrad({ players: mk(8), history: [], round: 1 }).relaxed).toBeUndefined();
  });
});
