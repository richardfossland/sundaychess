import { describe, expect, it } from "vitest";
import { bergerTable, pairRound, pairRoundRobin, roundRobinRounds, roundRobinSchedule } from "@/lib/tournament/pairing";
import { mk } from "./helpers";

// FIDE Handbook C.05 Annex 1, "w-b" per round (white first).
const FIDE: Record<number, string[]> = {
  4: ["1-4 2-3", "4-3 1-2", "2-4 3-1"],
  6: ["1-6 2-5 3-4", "6-4 5-3 1-2", "2-6 3-1 4-5", "6-5 1-4 2-3", "3-6 4-2 5-1"],
  8: [
    "1-8 2-7 3-6 4-5",
    "8-5 6-4 7-3 1-2",
    "2-8 3-1 4-7 5-6",
    "8-6 7-5 1-4 2-3",
    "3-8 4-2 5-1 6-7",
    "8-7 1-6 2-5 3-4",
    "4-8 5-3 6-2 7-1",
  ],
  10: [
    "1-10 2-9 3-8 4-7 5-6",
    "10-6 7-5 8-4 9-3 1-2",
    "2-10 3-1 4-9 5-8 6-7",
    "10-7 8-6 9-5 1-4 2-3",
    "3-10 4-2 5-1 6-9 7-8",
    "10-8 9-7 1-6 2-5 3-4",
    "4-10 5-3 6-2 7-1 8-9",
    "10-9 1-8 2-7 3-6 4-5",
    "5-10 6-4 7-3 8-2 9-1",
  ],
};

const fmt = (g: { white: number; black: number }[]) => g.map((x) => `${x.white}-${x.black}`).join(" ");

describe("golden: FIDE Berger tables", () => {
  for (const n of [4, 6, 8, 10]) {
    it(`n=${n} matches Annex 1`, () => {
      expect(bergerTable(n).map(fmt)).toEqual(FIDE[n]);
    });
  }

  it("odd n (5,7,9) = table n+1 with the dummy removed", () => {
    for (const n of [5, 7, 9]) {
      const sched = roundRobinSchedule(mk(n)).rounds;
      expect(sched).toHaveLength(n);
      const table = FIDE[n + 1];
      sched.forEach((games, r) => {
        const expected = table[r]
          .split(" ")
          .map((s) => s.split("-").map(Number))
          .map(([w, b]) => (w === n + 1 ? `p${b}-bye` : b === n + 1 ? `p${w}-bye` : `p${w}-p${b}`));
        const got = games.map((g) => `${g.white}-${g.black ?? "bye"}`);
        expect(got).toEqual([...expected.filter((e) => !e.endsWith("bye")), ...expected.filter((e) => e.endsWith("bye"))]);
      });
    }
  });
});

describe("properties", () => {
  it("everyone meets everyone exactly once, one bye each for odd n, colours balanced", () => {
    for (let n = 2; n <= 14; n++) {
      const rounds = roundRobinSchedule(mk(n)).rounds;
      expect(rounds).toHaveLength(roundRobinRounds(n));
      const met = new Map<string, number>();
      const byes = new Map<string, number>();
      const diff = new Map<string, number>();
      for (const r of rounds) {
        const seen = new Set<string>();
        for (const g of r) {
          for (const id of [g.white, g.black]) if (id) {
            expect(seen.has(id)).toBe(false);
            seen.add(id);
          }
          if (g.black === null) byes.set(g.white, (byes.get(g.white) ?? 0) + 1);
          else {
            const k = [g.white, g.black].sort().join("|");
            met.set(k, (met.get(k) ?? 0) + 1);
            diff.set(g.white, (diff.get(g.white) ?? 0) + 1);
            diff.set(g.black, (diff.get(g.black) ?? 0) - 1);
          }
        }
        expect(seen.size).toBe(n);
      }
      expect(met.size).toBe((n * (n - 1)) / 2);
      expect([...met.values()].every((v) => v === 1)).toBe(true);
      if (n % 2) expect([...byes.values()]).toEqual(Array(n).fill(1));
      for (const d of diff.values()) expect(Math.abs(d)).toBeLessThanOrEqual(1);
    }
  });

  it("double RR: second cycle reverses colours, each pair twice, no 3 same colours in a row", () => {
    for (let n = 3; n <= 12; n++) {
      const rounds = roundRobinSchedule(mk(n), { double: true }).rounds;
      expect(rounds).toHaveLength(roundRobinRounds(n, true));
      const half = rounds.length / 2;
      const dir = new Map<string, string>();
      for (const [ri, r] of rounds.entries()) {
        for (const g of r) {
          if (g.black === null) continue;
          const k = [g.white, g.black].sort().join("|");
          if (ri < half) dir.set(k, g.white);
          else expect(dir.get(k)).toBe(g.black);
        }
      }
      // n=4 has only three rounds per cycle; a run of 3 is unavoidable with the table order.
      for (const p of n === 4 ? [] : mk(n)) {
        let run = 0;
        let last = "";
        for (const r of rounds) {
          const g = r.find((x) => x.white === p.id || x.black === p.id)!;
          if (g.black === null) continue; // bye breaks nothing relevant
          const c = g.white === p.id ? "W" : "B";
          run = c === last ? run + 1 : 1;
          last = c;
          expect(run).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("deterministic and start-number driven (input order irrelevant)", () => {
    const a = roundRobinSchedule(mk(7));
    const b = roundRobinSchedule(mk(7).reverse());
    expect(b).toEqual(a);
  });
});

describe("pairRoundRobin (shared interface)", () => {
  it("round N from the table, boards numbered, byes last", () => {
    const out = pairRoundRobin({ players: mk(5), history: [], round: 1 });
    expect(out.pairings.map((p) => `${p.board}:${p.white}-${p.black ?? "bye"}`)).toEqual([
      "1:p2-p5",
      "2:p3-p4",
      "3:p1-bye",
    ]);
    expect(out.pairings[2].byeType).toBe("full");
  });

  it("round beyond the schedule → empty", () => {
    expect(pairRoundRobin({ players: mk(4), history: [], round: 4 }).pairings).toEqual([]);
  });

  it("withdrawn player: opponent gets a forfeit-win bye, schedule unchanged", () => {
    const players = mk(4).map((p) => (p.id === "p4" ? { ...p, status: "withdrawn" as const } : p));
    const out = pairRoundRobin({ players, history: [], round: 1 }); // 1-4, 2-3
    expect(out.pairings.map((p) => `${p.white}-${p.black ?? "bye"}:${p.byeType ?? ""}`)).toEqual([
      "p2-p3:",
      "p1-bye:full",
    ]);
  });

  it("both inactive → nothing; bye request → requested bye + forfeit win for opponent", () => {
    const players = mk(4).map((p) =>
      p.id === "p1" || p.id === "p4" ? { ...p, status: "withdrawn" as const } : p.id === "p2" ? { ...p, byeRequest: "half" as const } : p,
    );
    const out = pairRoundRobin({ players, history: [], round: 1 });
    expect(out.pairings.map((p) => `${p.white}-${p.black ?? "bye"}:${p.byeType}`).sort()).toEqual([
      "p2-bye:half",
      "p3-bye:full",
    ]);
  });

  it("dispatcher", () => {
    const input = { players: mk(6), history: [], round: 2 };
    expect(pairRound("roundRobin", input)).toEqual(pairRoundRobin(input));
    expect(pairRound("roundRobin", input, { double: true }).pairings).toHaveLength(3);
  });
});
