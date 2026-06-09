import { describe, expect, it } from "vitest";
import {
  bracketRounds,
  buildFirstRound,
  effectivePlayoffSize,
  nextRound,
  seedOrder,
  type BracketMatch,
  type SeededPlayer,
} from "@/lib/tournament/bracket";

describe("effectivePlayoffSize", () => {
  it("returns 0 when playoff is off", () => {
    expect(effectivePlayoffSize(0, 20)).toBe(0);
  });
  it("shrinks to nearest power of two <= player count", () => {
    expect(effectivePlayoffSize(8, 8)).toBe(8);
    expect(effectivePlayoffSize(8, 6)).toBe(4);
    expect(effectivePlayoffSize(16, 10)).toBe(8);
    expect(effectivePlayoffSize(16, 3)).toBe(0); // under 4 → no playoff
  });
});

describe("seedOrder", () => {
  it("pairs 1vN, 2v(N-1) and balances the bracket", () => {
    expect(seedOrder(4)).toEqual([
      [1, 4],
      [2, 3],
    ]);
    // size 8 — canonical order; seed 1 and 2 only meet in the final.
    const o8 = seedOrder(8);
    expect(o8).toHaveLength(4);
    expect(o8).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
    // every seed 1..8 appears exactly once
    const seen = new Set(o8.flat());
    expect(seen.size).toBe(8);
    // seed 1 (top half) and seed 2 (bottom half) are in opposite halves.
    const topHalf = o8.slice(0, 2).flat();
    const bottomHalf = o8.slice(2).flat();
    expect(topHalf).toContain(1);
    expect(bottomHalf).toContain(2);
  });
});

describe("buildFirstRound + nextRound", () => {
  it("resolves an 8-player bracket to a single winner", () => {
    const seeded: SeededPlayer[] = Array.from({ length: 8 }, (_, i) => ({
      playerId: `p${i + 1}`,
      seed: i + 1,
    }));
    let round = buildFirstRound(seeded);
    expect(round).toHaveLength(4);
    expect(bracketRounds(8)).toBe(3);

    let totalRounds = 0;
    while (round.length >= 1) {
      totalRounds++;
      // Top seed always wins (deterministic).
      round.forEach((m: BracketMatch) => {
        m.winnerPlayerId =
          (m.topSeed ?? 99) <= (m.bottomSeed ?? 99)
            ? m.topPlayerId
            : m.bottomPlayerId;
      });
      const nxt = nextRound(round);
      if (nxt.length === 0) break;
      round = nxt;
    }

    expect(totalRounds).toBe(3);
    expect(round).toHaveLength(1);
    expect(round[0].winnerPlayerId).toBe("p1"); // top seed wins out
  });
});
