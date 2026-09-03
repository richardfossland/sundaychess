import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { moveCue } from "@/lib/chess/moveCue";

// L5: the sound cue used to parse the arriving FEN into a whole Chess instance
// on EVERY move, on both the own-move and the opponent-broadcast path, purely
// to ask inCheck(). The SAN we already hold carries the same answer in its `+`
// / `#` marks. The rule this file enforces: the SAN fast path and the FEN
// fallback must agree, cue for cue, on every position.

/** Play `sans` from the start and return the FEN before and after the last one. */
function play(sans: string[]): { prevFen: string; fen: string; san: string } {
  const c = new Chess();
  for (const s of sans.slice(0, -1)) c.move(s);
  const prevFen = c.fen();
  const m = c.move(sans[sans.length - 1]);
  return { prevFen, fen: c.fen(), san: m.san };
}

const POSITIONS: [label: string, sans: string[], cue: "move" | "capture" | "check"][] = [
  // quiet move: no check, no capture
  ["a quiet opening move", ["e4"], "move"],
  // capture without check
  ["a capture", ["e4", "d5", "exd5"], "capture"],
  // check without capture
  ["a check", ["e4", "f5", "Qh5+"], "check"],
  // mate, which is also a capture — check must win, as it always has
  ["a mating capture", ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"], "check"],
];

describe("moveCue", () => {
  it.each(POSITIONS)("%s → %s via the SAN fast path", (_label, sans, cue) => {
    const { prevFen, fen, san } = play(sans);
    expect(moveCue(prevFen, fen, san)).toBe(cue);
  });

  it.each(POSITIONS)("%s → %s via the FEN fallback", (_label, sans, cue) => {
    const { prevFen, fen } = play(sans);
    expect(moveCue(prevFen, fen)).toBe(cue);
  });

  it("agrees with itself on every position, with and without the SAN", () => {
    for (const [, sans] of POSITIONS) {
      const { prevFen, fen, san } = play(sans);
      expect(moveCue(prevFen, fen, san)).toBe(moveCue(prevFen, fen));
    }
  });

  it("reads mate off `#` and check off `+` without touching the FEN", () => {
    // Proof the fast path really is a fast path: a FEN this unparseable would
    // throw in `new Chess()`, and the cue still comes out right.
    expect(moveCue("", "not-a-fen", "Qxf7#")).toBe("check");
    expect(moveCue("", "not-a-fen", "Qh5+")).toBe("check");
  });

  it("falls back to the FEN when the SAN is missing, null or empty", () => {
    const { prevFen, fen } = play(["e4", "f5", "Qh5+"]);
    expect(moveCue(prevFen, fen, undefined)).toBe("check");
    expect(moveCue(prevFen, fen, null)).toBe("check");
    expect(moveCue(prevFen, fen, "")).toBe("check");
  });

  it("never throws on an unparseable FEN with no SAN", () => {
    // Same tolerance as before: fall through to the piece-count check.
    expect(moveCue("", "garbage", undefined)).toBe("move");
  });

  it("treats a castle (no + or #) as a plain move", () => {
    const { prevFen, fen, san } = play(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"]);
    expect(san).toBe("O-O");
    expect(moveCue(prevFen, fen, san)).toBe("move");
    expect(moveCue(prevFen, fen)).toBe("move");
  });
});
