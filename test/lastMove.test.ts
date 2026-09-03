import { describe, expect, it } from "vitest";
import { lastMoveStylesKey } from "@/lib/chess/lastMove";

// L8: SpectateGame derives its <PlayBoard> `stylesKey` from exactly the same
// {from,to} pair its squareStyles highlight — this digest IS that derivation,
// so it's the seam that keeps the two impossible to drift apart (see the
// header of lib/client/PlayBoard.tsx for why the digest, not object identity,
// is what gates the board's memo).
describe("lastMoveStylesKey", () => {
  it("is stable across two null last moves (no game started yet)", () => {
    expect(lastMoveStylesKey(null)).toBe(lastMoveStylesKey(null));
  });

  it("differs between no last move and a real one", () => {
    expect(lastMoveStylesKey(null)).not.toBe(
      lastMoveStylesKey({ from: "e2", to: "e4" }),
    );
  });

  it("differs when the move itself differs", () => {
    const a = lastMoveStylesKey({ from: "e2", to: "e4" });
    const b = lastMoveStylesKey({ from: "d2", to: "d4" });
    expect(a).not.toBe(b);
  });

  it("is the same for two equal-by-value last moves (fresh object each poll)", () => {
    // GameDetail.lastMove is a fresh object from every api.game() fetch, even
    // when the actual move hasn't changed — the key must depend on the VALUE,
    // not the object's identity.
    const a = lastMoveStylesKey({ from: "g1", to: "f3" });
    const b = lastMoveStylesKey({ from: "g1", to: "f3" });
    expect(a).toBe(b);
  });

  it("cannot collide a shifted from/to across two half-moves (no unescaped separator ambiguity)", () => {
    // e.g. from:"e2e4" pasted straight through vs the pair {e2,e4to} must not
    // hash the same — the "|" separator between from and to must be real.
    const a = lastMoveStylesKey({ from: "e2", to: "e4" });
    const b = lastMoveStylesKey({ from: "e2e", to: "4" });
    expect(a).not.toBe(b);
  });
});
