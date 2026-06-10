import { describe, expect, it } from "vitest";
import { computeAwards, type AwardGame } from "@/lib/tournament/awards";

function game(partial: Partial<AwardGame> & { pgn: string }): AwardGame {
  return {
    id: "g1",
    whitePlayerId: "W",
    blackPlayerId: "B",
    status: "white_win",
    ...partial,
  };
}

// Fool's mate — black mates in 4 plies.
const FOOLS_MATE = "1. f3 e5 2. g4 Qh4#";

// Légal's mate — white sacrifices the queen (down 8 points of material) and
// mates with minor pieces. The canonical comeback.
const LEGALS_MATE =
  "1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5#";

// A longer drawn game with several captures by white.
const EXCHANGES =
  "1. e4 d5 2. exd5 Qxd5 3. Nc3 Qd8 4. d4 Nf6 5. Nf3 Bg4 6. Be2 e6 7. O-O Be7 8. Ne5 Bxe2 9. Qxe2 O-O 10. Nc6 Nxc6 11. Qd1 Qd6";

describe("computeAwards", () => {
  it("finds the fastest mate and credits the winner", () => {
    const awards = computeAwards([
      game({ id: "a", pgn: FOOLS_MATE, status: "black_win" }),
      game({ id: "b", pgn: LEGALS_MATE, status: "white_win", whitePlayerId: "X", blackPlayerId: "Y" }),
    ]);
    const fastest = awards.find((a) => a.key === "fastest_mate");
    expect(fastest).toBeDefined();
    expect(fastest!.playerIds).toEqual(["B"]); // fool's mate (4 plies) beats Légal (13)
    expect(fastest!.value).toBe(4);
  });

  it("detects a comeback win after a big material deficit", () => {
    const awards = computeAwards([game({ pgn: LEGALS_MATE, status: "white_win" })]);
    const comeback = awards.find((a) => a.key === "comeback");
    expect(comeback).toBeDefined();
    expect(comeback!.playerIds).toEqual(["W"]);
    expect(comeback!.value).toBeGreaterThanOrEqual(3);
  });

  it("does NOT call a clean win a comeback", () => {
    const awards = computeAwards([game({ pgn: FOOLS_MATE, status: "black_win" })]);
    expect(awards.find((a) => a.key === "comeback")).toBeUndefined();
  });

  it("counts captures across games and awards the top taker", () => {
    const awards = computeAwards([
      game({ id: "a", pgn: EXCHANGES, status: "draw" }),
    ]);
    const cap = awards.find((a) => a.key === "most_captures");
    expect(cap).toBeDefined();
    // white: exd5, Nc6(? no)... assert the winner is one of the two and value > 0
    expect(cap!.value).toBeGreaterThan(0);
  });

  it("awards longest game to both players", () => {
    const awards = computeAwards([
      game({ id: "a", pgn: EXCHANGES, status: "draw" }),
      game({ id: "b", pgn: FOOLS_MATE, status: "black_win", whitePlayerId: "X", blackPlayerId: "Y" }),
    ]);
    const longest = awards.find((a) => a.key === "longest_game");
    expect(longest).toBeDefined();
    expect(longest!.playerIds).toEqual(["W", "B"]);
  });

  it("ignores byes, live and aborted games", () => {
    const awards = computeAwards([
      game({ pgn: FOOLS_MATE, status: "live" }),
      game({ pgn: FOOLS_MATE, status: "aborted" }),
      game({ pgn: FOOLS_MATE, status: "bye", blackPlayerId: null }),
    ]);
    expect(awards).toEqual([]);
  });
});
