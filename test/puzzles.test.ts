import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { PUZZLES } from "@/lib/puzzles";

/** Every shipped puzzle must be a legal position with at least one
 * checkmate-in-1 for the side to move. */
describe("puzzle pack", () => {
  it("has unique ids", () => {
    const ids = PUZZLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const p of PUZZLES) {
    it(`${p.id} is a valid mate-in-1`, () => {
      const chess = new Chess(p.fen); // throws on an illegal position
      expect(chess.isGameOver()).toBe(false);

      const mates = chess.moves({ verbose: true }).filter((m) => {
        const c = new Chess(p.fen);
        c.move(m.san);
        return c.isCheckmate();
      });
      expect(mates.length, `${p.id}: no mating move found`).toBeGreaterThan(0);
    });
  }
});
