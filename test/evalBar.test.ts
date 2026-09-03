import { describe, expect, it } from "vitest";
import { barFromEval, calloutFor, type FenEval } from "@/lib/chess/evalBar";

describe("barFromEval", () => {
  it("sits neutral and unlabelled before the first evaluation arrives", () => {
    const b = barFromEval(null);
    expect(b).toMatchObject({ whitePct: 50, label: "–", known: false });
  });

  it("is level at 0.00", () => {
    const b = barFromEval({ cp: 0, mate: null });
    expect(b.whitePct).toBe(50);
    expect(b.label).toBe("+0.0");
    expect(b.known).toBe(true);
  });

  it("fills toward White as White's advantage grows, and never past 98%", () => {
    const small = barFromEval({ cp: 120, mate: null });
    const big = barFromEval({ cp: 900, mate: null });
    expect(small.whitePct).toBeGreaterThan(50);
    expect(big.whitePct).toBeGreaterThan(small.whitePct);
    expect(barFromEval({ cp: 100000, mate: null }).whitePct).toBe(98);
    expect(barFromEval({ cp: -100000, mate: null }).whitePct).toBe(2);
  });

  it("labels a Black advantage with a real minus sign", () => {
    expect(barFromEval({ cp: -70, mate: null }).label).toBe("−0.7");
    expect(barFromEval({ cp: -70, mate: null }).whiteAhead).toBe(false);
  });

  it("shows a mate as # / −# and pins the bar", () => {
    expect(barFromEval({ cp: 100000, mate: 1 })).toMatchObject({ label: "#", whitePct: 98 });
    expect(barFromEval({ cp: -100000, mate: -1 })).toMatchObject({ label: "−#", whitePct: 2 });
  });
});

// Two positions one ply apart: 1.e4.
const START: FenEval = {
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  cp: 0,
  mate: null,
};
// After 1.e4 — Black to move. Also the "before" of the ...e5 pair below.
const afterWhite = (cp: number): FenEval => ({
  fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  cp,
  mate: null,
});
// After 1.e4 e5 — White to move, one ply after `afterWhite`.
const afterBlack = (cp: number): FenEval => ({
  fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  cp,
  mate: null,
});

describe("calloutFor", () => {
  it("says nothing about the first position it ever sees", () => {
    expect(calloutFor(null, afterWhite(-900))).toBeNull();
  });

  it("says nothing when the position has not changed", () => {
    const e = afterWhite(0);
    expect(calloutFor(e, { ...e, cp: -900 })).toBeNull();
  });

  it("says nothing about a quiet move", () => {
    expect(calloutFor(START, afterWhite(60))).toBeNull();
  });

  it("calls White's own big loss a blunder, and a big gain brilliant", () => {
    expect(calloutFor(START, afterWhite(-400))).toBe("blunder");
    expect(calloutFor(START, afterWhite(400))).toBe("brilliant");
  });

  it("reads the swing from the MOVER's side, so Black's blunder is not praise", () => {
    // Black moved and the White-relative score went UP → bad for Black.
    expect(calloutFor(afterWhite(0), afterBlack(400))).toBe("blunder");
    expect(calloutFor(afterWhite(0), afterBlack(-400))).toBe("brilliant");
  });

  it("calls a lead changing hands a swing", () => {
    expect(calloutFor({ ...START, cp: 300 }, afterWhite(-300))).toBe("swing");
    expect(calloutFor({ ...START, cp: -300 }, afterWhite(300))).toBe("swing");
  });

  it("calls checkmate", () => {
    const before: FenEval = {
      fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2",
      cp: 0,
      mate: null,
    };
    const mated: FenEval = {
      fen: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
      cp: -100000,
      mate: -1,
    };
    expect(calloutFor(before, mated)).toBe("mate");
  });

  it("stays quiet when the two positions are not one ply apart", () => {
    // Evals can be dropped (a slow answer loses to a newer one). Blaming a
    // two-ply swing on whoever happened to move first would be a lie.
    expect(calloutFor(START, afterBlack(-900))).toBeNull();
  });

  it("stays quiet on an unreadable position", () => {
    // Fen-shaped (so the ply guard passes) but not a legal board.
    const broken: FenEval = { fen: "9999999/8/8/8/8/8/8/8 b - - 0 1", cp: -900, mate: null };
    expect(calloutFor(START, broken)).toBeNull();
  });
});
