import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Player, Round, Tournament } from "@/lib/types";

const { store } = vi.hoisted(() => ({
  store: {
    listPlayers: vi.fn(),
    listGames: vi.fn(),
    listRounds: vi.fn(),
    listGamesForRound: vi.fn(),
    setPlayerSeed: vi.fn(),
    setRoundStatus: vi.fn(),
    createRound: vi.fn(),
    createGame: vi.fn(),
    updateTournament: vi.fn(),
  },
}));
vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn() }));

import {
  advancePlayoff,
  maybeStartPlayoff,
  playoffRoundResolved,
} from "@/lib/server/playoff";

function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: "t",
    join_pin: "000000",
    host_code: "AAAA-AA",
    host_user_id: null,
    title: null,
    status: "league",
    config: { leagueRounds: 3, playoff: true, playoffSize: 8, roundTimerSec: null },
    current_round: 3,
    created_at: "",
    ...over,
  };
}
function players(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    tournament_id: "t",
    display_name: `P${String(i + 1).padStart(2, "0")}`,
    resume_code: "AAAA-AA",
    score: 0,
    tiebreak: 0,
    status: "active" as const,
    seed: null,
    joined_at: "",
  }));
}
let gid = 0;
function game(white: string, black: string, status: Game["status"]): Game {
  return {
    id: `g${gid++}`,
    tournament_id: "t",
    round_id: "pr1",
    white_player_id: white,
    black_player_id: black,
    fen: "",
    pgn: "",
    status,
    result_source: null,
    turn: "w",
    draw_offered_by: null,
    updated_at: "",
  };
}
const playoffRound = (number: number): Round => ({
  id: "pr1",
  tournament_id: "t",
  number,
  phase: "playoff",
  status: "live",
  started_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  gid = 0;
  store.createRound.mockResolvedValue(playoffRound(1));
  store.createGame.mockResolvedValue({});
  store.setPlayerSeed.mockResolvedValue(undefined);
});

describe("maybeStartPlayoff", () => {
  it("returns false when playoff is disabled", async () => {
    const t = tournament({ config: { leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null } });
    expect(await maybeStartPlayoff(t)).toBe(false);
  });

  it("seeds top 8 and builds the first round (4 games)", async () => {
    store.listPlayers.mockResolvedValue(players(8));
    store.listGames.mockResolvedValue([]);
    const started = await maybeStartPlayoff(tournament());
    expect(started).toBe(true);
    expect(store.setPlayerSeed).toHaveBeenCalledTimes(8);
    expect(store.createRound).toHaveBeenCalledWith("t", 1, "playoff", "live");
    expect(store.createGame).toHaveBeenCalledTimes(4);
    expect(store.updateTournament).toHaveBeenCalledWith("t", {
      status: "playoff",
      current_round: 1,
    });
  });

  it("shrinks the bracket to fit fewer players (6 → 4)", async () => {
    store.listPlayers.mockResolvedValue(players(6));
    store.listGames.mockResolvedValue([]);
    await maybeStartPlayoff(tournament());
    expect(store.createGame).toHaveBeenCalledTimes(2); // 4-player bracket
  });
});

describe("advancePlayoff", () => {
  it("pairs winners into the next round", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listGamesForRound.mockResolvedValue([
      game("p1", "p8", "white_win"),
      game("p4", "p5", "white_win"),
      game("p2", "p7", "black_win"),
      game("p3", "p6", "white_win"),
    ]);
    const status = await advancePlayoff(tournament({ current_round: 1 }));
    expect(status).toBe("playoff");
    expect(store.setRoundStatus).toHaveBeenCalledWith("pr1", "done");
    expect(store.createRound).toHaveBeenCalledWith("t", 2, "playoff", "live");
    expect(store.createGame).toHaveBeenCalledTimes(2); // 4 winners → 2 games
    expect(store.updateTournament).toHaveBeenCalledWith("t", { current_round: 2 });
  });

  it("crowns the champion when the final is decided", async () => {
    store.listRounds.mockResolvedValue([playoffRound(3)]);
    store.listGamesForRound.mockResolvedValue([game("p1", "p2", "white_win")]);
    const status = await advancePlayoff(tournament({ current_round: 3 }));
    expect(status).toBe("finished");
    expect(store.updateTournament).toHaveBeenCalledWith("t", { status: "finished" });
    expect(store.createGame).not.toHaveBeenCalled();
  });

  it("refuses to advance past a drawn playoff game", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listGamesForRound.mockResolvedValue([
      game("p1", "p8", "white_win"),
      game("p4", "p5", "draw"), // no winner
      game("p2", "p7", "black_win"),
      game("p3", "p6", "white_win"),
    ]);
    await expect(advancePlayoff(tournament({ current_round: 1 }))).rejects.toThrow(
      "needs_decision",
    );
  });
});

describe("playoffRoundResolved", () => {
  it("is false while a game is live", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listGamesForRound.mockResolvedValue([game("p1", "p2", "live")]);
    expect(await playoffRoundResolved(tournament({ current_round: 1 }))).toBe(false);
  });
  it("is true when all are resolved", async () => {
    store.listRounds.mockResolvedValue([playoffRound(1)]);
    store.listGamesForRound.mockResolvedValue([game("p1", "p2", "white_win")]);
    expect(await playoffRoundResolved(tournament({ current_round: 1 }))).toBe(true);
  });
});
