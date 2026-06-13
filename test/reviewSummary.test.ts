import { describe, expect, it } from "vitest";
import type { PlayerReview } from "@/lib/chess/analysis";
import { reviewFacts, templatedSummaryNo } from "@/lib/chess/reviewSummary";

function emptyCounts() {
  return {
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    missed_mate: 0,
    found_mate: 0,
  };
}

function review(over: Partial<PlayerReview> = {}): PlayerReview {
  return {
    side: "w",
    name: "Kari",
    moves: [],
    counts: emptyCounts(),
    worstMoveIndex: -1,
    averageCpLoss: 0,
    ...over,
  };
}

describe("reviewFacts", () => {
  it("maps a white win to outcome 'won' for white", () => {
    const f = reviewFacts(review({ side: "w" }), "white_win");
    expect(f.outcome).toBe("won");
    expect(f.colorNo).toBe("Hvit");
  });

  it("maps a white win to outcome 'lost' for black", () => {
    const f = reviewFacts(review({ side: "b", name: "Ola" }), "white_win");
    expect(f.outcome).toBe("lost");
    expect(f.colorNo).toBe("Svart");
  });

  it("draw is a draw for both sides", () => {
    expect(reviewFacts(review({ side: "w" }), "draw").outcome).toBe("draw");
    expect(reviewFacts(review({ side: "b" }), "draw").outcome).toBe("draw");
  });

  it("rolls up counts and accuracy", () => {
    const counts = { ...emptyCounts(), good: 3, best: 2, blunder: 1, mistake: 1 };
    const moves = Array.from({ length: 7 }, (_, i) => ({
      ply: i + 1,
      moveNumber: i + 1,
      side: "w" as const,
      san: "x",
      from: "a1",
      to: "a2",
      cpBefore: 0,
      cpAfter: 0,
      delta: i === 0 ? -300 : -10,
      hadMateBefore: false,
      isMate: false,
      tag: "good" as const,
    }));
    const f = reviewFacts(
      review({ counts, moves, worstMoveIndex: 0, averageCpLoss: 50 }),
      "draw",
    );
    expect(f.goodOrBest).toBe(5);
    expect(f.blunders).toBe(1);
    expect(f.mistakes).toBe(1);
    expect(f.totalMoves).toBe(7);
    expect(f.accuracy).toBeGreaterThan(0);
    expect(f.accuracy).toBeLessThanOrEqual(99);
    expect(f.worstMove).toMatchObject({ moveNumber: 1, san: "x" });
  });

  it("higher cp loss yields lower accuracy", () => {
    const clean = reviewFacts(review({ averageCpLoss: 0 }), "draw").accuracy;
    const sloppy = reviewFacts(review({ averageCpLoss: 200 }), "draw").accuracy;
    expect(clean).toBeGreaterThan(sloppy);
  });
});

describe("templatedSummaryNo", () => {
  const base = reviewFacts(review({ name: "Kari" }), "draw");

  it("is deterministic, Norwegian, and names the player", () => {
    const a = templatedSummaryNo(base);
    const b = templatedSummaryNo(base);
    expect(a).toBe(b); // pure
    expect(a).toContain("Kari");
    expect(a.length).toBeGreaterThan(40);
  });

  it("celebrates a delivered mate", () => {
    const f = reviewFacts(
      review({ counts: { ...emptyCounts(), found_mate: 1 } }),
      "white_win",
    );
    expect(templatedSummaryNo(f).toLowerCase()).toContain("matt");
  });

  it("praises a clean game with no errors", () => {
    const f = reviewFacts(review({ counts: { ...emptyCounts(), best: 10 } }), "draw");
    const s = templatedSummaryNo(f);
    expect(s).toContain("unngikk de store feilene");
  });

  it("mentions blunders and points at the worst move", () => {
    const moves = [
      {
        ply: 1,
        moveNumber: 5,
        side: "w" as const,
        san: "Qd1",
        from: "d4",
        to: "d1",
        cpBefore: 0,
        cpAfter: -400,
        delta: -400,
        hadMateBefore: false,
        isMate: false,
        tag: "blunder" as const,
      },
    ];
    const f = reviewFacts(
      review({ counts: { ...emptyCounts(), blunder: 1 }, moves, worstMoveIndex: 0 }),
      "black_win",
    );
    const s = templatedSummaryNo(f);
    expect(s.toLowerCase()).toContain("tabbe");
    expect(s).toContain("Qd1");
    expect(s).toContain("trekk 5");
  });

  it("handles singular vs plural Norwegian counts", () => {
    const one = templatedSummaryNo(
      reviewFacts(review({ counts: { ...emptyCounts(), blunder: 1 } }), "draw"),
    );
    const many = templatedSummaryNo(
      reviewFacts(review({ counts: { ...emptyCounts(), blunder: 3 } }), "draw"),
    );
    expect(one).toContain("1 tabbe");
    expect(many).toContain("3 tabber");
  });
});
