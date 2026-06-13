import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Player, Tournament, TournamentConfig } from "@/lib/types";

// Mock the DB + broadcast boundary; keep the REAL duel orchestration logic.
// Verifies game-1 start, colour-alternating advance, and match finish.
const getTournament = vi.fn();
const listPlayers = vi.fn();
const listGames = vi.fn();
const createRound = vi.fn();
const createGame = vi.fn();
const updateTournament = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  listPlayers: (...a: unknown[]) => listPlayers(...a),
  listGames: (...a: unknown[]) => listGames(...a),
  createRound: (...a: unknown[]) => createRound(...a),
  createGame: (...a: unknown[]) => createGame(...a),
  updateTournament: (...a: unknown[]) => updateTournament(...a),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn(() => Promise.resolve()) }));

import { advanceDuel, startDuel } from "@/lib/server/duel";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function tour(over: Partial<Tournament> = {}, config: Partial<TournamentConfig> = {}): Tournament {
  return {
    id: "t",
    join_pin: "123456",
    host_code: "AAAA-AA",
    host_user_id: null,
    title: "Ada",
    status: "lobby",
    config: { format: "duel", bestOf: 3, leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null, ...config },
    current_round: 0,
    created_at: "",
    ...over,
  };
}
function player(id: string): Player {
  return { id, tournament_id: "t", display_name: id, resume_code: "X", score: 0, tiebreak: 0, status: "active", seed: null, joined_at: id };
}
let seq = 0;
function game(white: string, black: string, status: Game["status"]): Game {
  return {
    id: `g${seq}`, tournament_id: "t", round_id: `r${seq}`,
    white_player_id: white, black_player_id: black, fen: START, pgn: "",
    status, result_source: status === "live" ? null : "play", turn: "w",
    draw_offered_by: null, updated_at: `2026-01-01T00:00:0${seq++}.000Z`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  createRound.mockResolvedValue({ id: "round-new" });
  createGame.mockResolvedValue({ id: "game-new" });
  updateTournament.mockResolvedValue(undefined);
});

describe("startDuel", () => {
  it("creates game 1 (creator white) when both players are present", async () => {
    getTournament.mockResolvedValue(tour());
    listPlayers.mockResolvedValue([player("p1"), player("p2")]);
    listGames.mockResolvedValue([]);

    expect(await startDuel("t")).toBe(true);
    expect(createRound).toHaveBeenCalledWith("t", 1, "league", "live");
    expect(createGame.mock.calls[0][0]).toMatchObject({
      whitePlayerId: "p1",
      blackPlayerId: "p2",
      roundId: "round-new",
    });
    expect(updateTournament).toHaveBeenCalledWith("t", { status: "league", current_round: 1 });
  });

  it("is a no-op when a game already exists", async () => {
    getTournament.mockResolvedValue(tour());
    listPlayers.mockResolvedValue([player("p1"), player("p2")]);
    listGames.mockResolvedValue([game("p1", "p2", "live")]);
    expect(await startDuel("t")).toBe(true);
    expect(createGame).not.toHaveBeenCalled();
  });

  it("returns false when only one player has joined", async () => {
    getTournament.mockResolvedValue(tour());
    listPlayers.mockResolvedValue([player("p1")]);
    listGames.mockResolvedValue([]);
    expect(await startDuel("t")).toBe(false);
    expect(createGame).not.toHaveBeenCalled();
  });

  it("ignores non-duel tournaments", async () => {
    getTournament.mockResolvedValue(tour({}, { format: "league" }));
    listPlayers.mockResolvedValue([player("p1"), player("p2")]);
    expect(await startDuel("t")).toBe(false);
  });
});

describe("advanceDuel", () => {
  it("creates game 2 with swapped colours after an undecided game 1", async () => {
    getTournament.mockResolvedValue(tour({ status: "league", current_round: 1 }));
    listPlayers.mockResolvedValue([player("p1"), player("p2")]);
    listGames.mockResolvedValue([game("p1", "p2", "white_win")]); // 1-0, target 2 → not decided

    await advanceDuel("t");
    expect(createRound).toHaveBeenCalledWith("t", 2, "league", "live");
    expect(createGame.mock.calls[0][0]).toMatchObject({ whitePlayerId: "p2", blackPlayerId: "p1" });
    expect(updateTournament).toHaveBeenCalledWith("t", { current_round: 2 });
  });

  it("finishes the match when a player reaches the target", async () => {
    getTournament.mockResolvedValue(tour({ status: "league", current_round: 2 }));
    listPlayers.mockResolvedValue([player("p1"), player("p2")]);
    // p1 wins both → 2-0, target 2 → decided
    listGames.mockResolvedValue([game("p1", "p2", "white_win"), game("p2", "p1", "black_win")]);

    await advanceDuel("t");
    expect(updateTournament).toHaveBeenCalledWith("t", { status: "finished" });
    expect(createGame).not.toHaveBeenCalled();
  });

  it("does nothing while a game is still live", async () => {
    getTournament.mockResolvedValue(tour({ status: "league" }));
    listPlayers.mockResolvedValue([player("p1"), player("p2")]);
    listGames.mockResolvedValue([game("p1", "p2", "live")]);

    await advanceDuel("t");
    expect(createGame).not.toHaveBeenCalled();
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it("ignores non-duel tournaments", async () => {
    getTournament.mockResolvedValue(tour({ status: "league" }, { format: "league" }));
    await advanceDuel("t");
    expect(listGames).not.toHaveBeenCalled();
  });
});
