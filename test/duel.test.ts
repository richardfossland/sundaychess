import { describe, expect, it } from "vitest";
import type { Game, GameStatus } from "@/lib/types";
import {
  clinchTarget,
  duelState,
  hasLiveGame,
  nextGameColours,
  normalizeBestOf,
  whiteForGame,
} from "@/lib/duel/match";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

let seq = 0;
function game(
  white: string,
  black: string | null,
  status: GameStatus,
): Game {
  // updated_at strictly increasing so play order is deterministic.
  const ts = `2026-01-01T00:00:${String(seq++).padStart(2, "0")}.000Z`;
  return {
    id: `g${seq}`,
    tournament_id: "t",
    round_id: `r${seq}`,
    white_player_id: white,
    black_player_id: black,
    fen: START,
    pgn: "",
    status,
    result_source: status === "live" ? null : "play",
    turn: "w",
    draw_offered_by: null,
    updated_at: ts,
  };
}

describe("clinchTarget / normalizeBestOf", () => {
  it("race-to-K: 1→1, 3→2, 5→3", () => {
    expect(clinchTarget(1)).toBe(1);
    expect(clinchTarget(3)).toBe(2);
    expect(clinchTarget(5)).toBe(3);
  });
  it("clamps junk to a single game", () => {
    expect(clinchTarget(0)).toBe(1);
    expect(clinchTarget(NaN)).toBe(1);
    expect(normalizeBestOf(4)).toBe(1);
    expect(normalizeBestOf("3")).toBe(1);
    expect(normalizeBestOf(5)).toBe(5);
  });
});

describe("colour alternation", () => {
  it("p1 is white in even games, p2 in odd", () => {
    expect(whiteForGame(0, "p1", "p2")).toBe("p1");
    expect(whiteForGame(1, "p1", "p2")).toBe("p2");
    expect(whiteForGame(2, "p1", "p2")).toBe("p1");
  });
  it("nextGameColours swaps consistently", () => {
    expect(nextGameColours(0, "p1", "p2")).toEqual({
      whitePlayerId: "p1",
      blackPlayerId: "p2",
    });
    expect(nextGameColours(1, "p1", "p2")).toEqual({
      whitePlayerId: "p2",
      blackPlayerId: "p1",
    });
  });
});

describe("duelState", () => {
  it("empty match: nothing decided", () => {
    const s = duelState([], "p1", "p2", 3);
    expect(s).toMatchObject({
      p1Score: 0,
      p2Score: 0,
      gamesPlayed: 0,
      target: 2,
      decided: false,
      winnerId: null,
      leaderId: null,
    });
  });

  it("best-of-1: a single decisive game ends it", () => {
    const s = duelState([game("p1", "p2", "white_win")], "p1", "p2", 1);
    expect(s.decided).toBe(true);
    expect(s.winnerId).toBe("p1");
    expect(s.results).toEqual(["p1"]);
  });

  it("counts colours correctly across alternating games", () => {
    // game 0: p1 white, wins. game 1: p2 white, p1 (black) wins → p1 2-0.
    const s = duelState(
      [game("p1", "p2", "white_win"), game("p2", "p1", "black_win")],
      "p1",
      "p2",
      3,
    );
    expect(s.p1Score).toBe(2);
    expect(s.p2Score).toBe(0);
    expect(s.decided).toBe(true);
    expect(s.winnerId).toBe("p1");
    expect(s.results).toEqual(["p1", "p1"]);
  });

  it("draws give ½ each and don't decide a bo3 on their own", () => {
    const s = duelState(
      [game("p1", "p2", "draw"), game("p2", "p1", "draw")],
      "p1",
      "p2",
      3,
    );
    expect(s.p1Score).toBe(1);
    expect(s.p2Score).toBe(1);
    expect(s.decided).toBe(false);
    expect(s.leaderId).toBe(null);
    // a 3rd decisive game then clinches it
    const s2 = duelState(
      [
        game("p1", "p2", "draw"),
        game("p2", "p1", "draw"),
        game("p1", "p2", "white_win"),
      ],
      "p1",
      "p2",
      3,
    );
    expect(s2.p1Score).toBe(2);
    expect(s2.decided).toBe(true);
    expect(s2.winnerId).toBe("p1");
  });

  it("ignores live games and byes when scoring", () => {
    const s = duelState(
      [game("p1", "p2", "white_win"), game("p2", "p1", "live")],
      "p1",
      "p2",
      3,
    );
    expect(s.gamesPlayed).toBe(1);
    expect(s.p1Score).toBe(1);
    expect(s.decided).toBe(false);
  });

  it("p2 can win too", () => {
    const s = duelState(
      [game("p1", "p2", "black_win"), game("p2", "p1", "white_win")],
      "p1",
      "p2",
      3,
    );
    expect(s.p2Score).toBe(2);
    expect(s.winnerId).toBe("p2");
  });
});

describe("hasLiveGame", () => {
  it("detects an in-progress game", () => {
    expect(hasLiveGame([game("p1", "p2", "white_win")])).toBe(false);
    expect(hasLiveGame([game("p1", "p2", "live")])).toBe(true);
  });
});
