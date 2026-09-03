import { describe, expect, it } from "vitest";
import type { Game } from "@/lib/types";
import { toPublicGame } from "@/lib/dto";

// R9: PGN is heavy (a full move-by-move history per decided game) and must
// never ride along on the 5s board poll — only a one-off `?full=1` fetch
// (awards/replay recap) opts in via `{ withPgn: true }`.

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: "g1",
    tournament_id: "t",
    round_id: "r",
    white_player_id: "white",
    black_player_id: "black",
    fen: START,
    pgn: "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#",
    status: "white_win",
    result_source: null,
    turn: "w",
    draw_offered_by: null,
    updated_at: "",
    ...over,
  };
}

describe("toPublicGame — pgn stays off the hot board poll (R9)", () => {
  it("omits pgn by default for a decided game", () => {
    const pub = toPublicGame(makeGame());
    expect(pub.pgn).toBeUndefined();
    expect("pgn" in pub).toBe(false);
  });

  it("omits pgn when withPgn is explicitly false", () => {
    const pub = toPublicGame(makeGame(), { withPgn: false });
    expect(pub.pgn).toBeUndefined();
  });

  it("includes pgn for a decided game only when withPgn is true", () => {
    const pub = toPublicGame(makeGame({ status: "white_win" }), { withPgn: true });
    expect(pub.pgn).toBe("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#");
  });

  it("includes pgn for a draw when withPgn is true", () => {
    const pub = toPublicGame(makeGame({ status: "draw" }), { withPgn: true });
    expect(pub.pgn).toBe("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#");
  });

  it("NEVER includes pgn for a live game, even with withPgn: true", () => {
    const pub = toPublicGame(makeGame({ status: "live" }), { withPgn: true });
    expect(pub.pgn).toBeUndefined();
  });

  it("omits pgn when the row has no pgn yet, even if decided + withPgn: true", () => {
    const pub = toPublicGame(makeGame({ status: "draw", pgn: "" }), { withPgn: true });
    expect(pub.pgn).toBeUndefined();
  });

  it("still returns the rest of the shape unchanged regardless of withPgn", () => {
    const pub = toPublicGame(makeGame(), { withPgn: true });
    expect(pub).toMatchObject({
      id: "g1",
      roundId: "r",
      whitePlayerId: "white",
      blackPlayerId: "black",
      fen: START,
      status: "white_win",
      turn: "w",
      slot: 0,
    });
  });
});
