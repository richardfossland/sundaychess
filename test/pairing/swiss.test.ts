import { describe, expect, it } from "vitest";
import {
  colourStatesFromHistory,
  pairKey,
  pairRound,
  requiredColour,
  swiss,
  type HistoryGame,
  type PairingPlayer,
} from "@/lib/tournament/pairing";
import { mk, mulberry32, scoresFrom, toHistory } from "./helpers";

const rated = (n: number): PairingPlayer[] => mk(n).map((p, i) => ({ ...p, rating: 1000 + ((i * 37) % n) * 10 }));

function play(players: PairingPlayer[], rounds: number, seed: number, system: "swiss" | "monrad" = "swiss") {
  const rng = mulberry32(seed);
  const history: HistoryGame[] = [];
  const outs = [];
  for (let r = 1; r <= rounds; r++) {
    const s = scoresFrom(players.map((p) => p.id), history);
    const ps = players.map((p) => ({ ...p, score: s.get(p.id) ?? 0 }));
    const out = pairRound(system, { players: ps, history, round: r });
    outs.push(out);
    history.push(...toHistory(r, out, rng));
  }
  return { history, outs };
}

describe("golden: Swiss", () => {
  it("round 1 seeds by rating: top half vs bottom half, colours alternate by board", () => {
    const ps = [1500, 1900, 1200, 1700, 1100, 1800, 1300, 1600].map((rating, i) => ({ ...mk(8)[i], rating }));
    const out = swiss({ players: ps, history: [], round: 1 });
    // order: p2 1900, p6 1800, p4 1700, p8 1600 | p1 1500, p7 1300, p3 1200, p5 1100
    expect(out.pairings.map((p) => `${p.white}-${p.black}`)).toEqual(["p2-p1", "p7-p6", "p4-p3", "p5-p8"]);
  });

  it("round 1 without ratings falls back to start number; odd → lowest seed has the bye", () => {
    const out = swiss({ players: mk(5), history: [], round: 1 });
    expect(out.pairings.map((p) => `${p.white}-${p.black ?? "bye"}`)).toEqual(["p1-p3", "p4-p2", "p5-bye"]);
    expect(out.pairings[2].byeType).toBe("full");
  });

  it("round 2: winners meet winners, no rematch, colours flip", () => {
    const history: HistoryGame[] = [
      { round: 1, white: "p1", black: "p3", result: "1-0" },
      { round: 1, white: "p4", black: "p2", result: "1-0" },
    ];
    const s = scoresFrom(["p1", "p2", "p3", "p4"], history);
    const ps = mk(4).map((p) => ({ ...p, score: s.get(p.id)! }));
    const out = swiss({ players: ps, history, round: 2 });
    expect(out.pairings.map((p) => pairKey(p.white, p.black!)).sort()).toEqual([pairKey("p1", "p4"), pairKey("p2", "p3")].sort());
    // p1 had white → black now; p4 had black → white now
    expect(out.pairings.find((p) => p.white === "p4")?.black).toBe("p1");
  });

  it("requested bye excluded; odd pool bye goes to player without one", () => {
    const history: HistoryGame[] = [
      { round: 1, white: "p5", black: null, result: "bye", byeType: "full" },
      { round: 1, white: "p1", black: "p2", result: "1-0" },
      { round: 1, white: "p3", black: "p4", result: "1-0" },
    ];
    const s = scoresFrom(mk(6).map((p) => p.id), history);
    const ps = mk(6).map((p) => ({ ...p, score: s.get(p.id)!, ...(p.id === "p6" ? { byeRequest: "zero" as const } : {}) }));
    const out = swiss({ players: ps, history, round: 2 });
    const byes = out.pairings.filter((p) => p.black === null);
    expect(byes.map((b) => `${b.white}:${b.byeType}`).sort()).toEqual(["p6:zero", expect.stringMatching(/^p[1-4]:full$/)].sort());
    expect(byes.some((b) => b.white === "p5")).toBe(false);
  });

  it("unavoidable rematch is flagged (3 players, 3 rounds)", () => {
    const { outs } = play(mk(2), 2, 1);
    expect(outs[1].pairings[0].rematch).toBe(true);
  });
});

describe("properties: Swiss", () => {
  for (const [n, rounds] of [[8, 5], [9, 6], [16, 7], [21, 8], [30, 9]] as const) {
    it(`n=${n}: valid, no repeats and colour-legal over ${rounds} rounds`, () => {
      for (const seed of [1, 2, 3]) {
        const players = rated(n);
        const { history, outs } = play(players, rounds, seed);
        const met = new Set<string>();
        for (const [ri, out] of outs.entries()) {
          const seen = new Set<string>();
          for (const p of out.pairings) {
            for (const id of [p.white, p.black]) if (id) {
              expect(seen.has(id)).toBe(false);
              seen.add(id);
            }
            if (p.black) {
              const k = pairKey(p.white, p.black);
              expect(met.has(k) && !p.rematch).toBe(false);
              met.add(k);
            }
          }
          expect(seen.size).toBe(n);
          expect(out.pairings.filter((p) => p.black === null)).toHaveLength(n % 2);
          expect(out.pairings.some((p) => p.rematch)).toBe(false); // rounds < n: avoidable
          expect(ri + 1).toBeLessThanOrEqual(rounds);
        }
        const byeCount = new Map<string, number>();
        for (const g of history) if (g.black === null) byeCount.set(g.white, (byeCount.get(g.white) ?? 0) + 1);
        expect(Math.max(0, ...byeCount.values())).toBeLessThanOrEqual(1);
        const cs = colourStatesFromHistory(history);
        for (const st of cs.values()) {
          expect(st.run).toBeLessThanOrEqual(2);
          expect(Math.abs(st.diff)).toBeLessThanOrEqual(2);
        }
        void requiredColour;
      }
    });
  }

  it("deterministic", () => {
    const a = play(rated(20), 6, 7);
    const b = play(rated(20), 6, 7);
    expect(b.outs).toEqual(a.outs);
  });

  it("pairs equal scores when possible (score groups of even size stay intact)", () => {
    const { history, outs } = play(rated(16), 4, 5);
    for (let r = 2; r <= 4; r++) {
      const before = scoresFrom(rated(16).map((p) => p.id), history.filter((g) => g.round < r));
      const floats = outs[r - 1].pairings.filter((p) => p.black && before.get(p.white) !== before.get(p.black)).length;
      expect(floats).toBeLessThanOrEqual(6);
    }
  });

  it("performance: 64 players × 9 rounds well under 200 ms", () => {
    play(rated(64), 2, 1); // warm-up
    const t0 = performance.now();
    play(rated(64), 9, 1);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
  });
});
