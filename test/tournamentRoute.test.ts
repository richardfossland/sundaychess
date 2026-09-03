import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Player, Round, Tournament } from "@/lib/types";

// R9: GET /api/tournament/[id] is the hot 5s board poll for every connected
// client (students + the host projector). PGN must stay OFF by default and
// only ride along when the caller explicitly asks for the finished-tournament
// recap via ?full=1 — verify both sides of that gate here.

const getTournament = vi.fn();
const listGames = vi.fn();
const listPlayers = vi.fn();
const listRounds = vi.fn();
const predictionPoints = vi.fn();
const listMoveStampsForGames = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  listGames: (...a: unknown[]) => listGames(...a),
  listPlayers: (...a: unknown[]) => listPlayers(...a),
  listRounds: (...a: unknown[]) => listRounds(...a),
  predictionPoints: (...a: unknown[]) => predictionPoints(...a),
  listMoveStampsForGames: (...a: unknown[]) => listMoveStampsForGames(...a),
}));

import { GET } from "@/app/api/tournament/[id]/route";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeTournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: "t1",
    join_pin: "123456",
    host_code: "HOST",
    host_user_id: null,
    title: null,
    status: "finished",
    config: { leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 1,
    created_at: "",
    ...over,
  };
}

function makeRound(over: Partial<Round> = {}): Round {
  return {
    id: "r1",
    tournament_id: "t1",
    number: 1,
    phase: "league",
    status: "done",
    started_at: null,
    ...over,
  };
}

function makePlayer(id: string, over: Partial<Player> = {}): Player {
  return {
    id,
    tournament_id: "t1",
    display_name: id,
    resume_code: `C-${id}`,
    score: 0,
    tiebreak: 0,
    status: "active",
    seed: null,
    joined_at: "",
    ...over,
  };
}

function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: "g1",
    tournament_id: "t1",
    round_id: "r1",
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

function req(url: string): Request {
  return new Request(url);
}

function ctx() {
  return { params: Promise.resolve({ id: "t1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getTournament.mockResolvedValue(makeTournament());
  listPlayers.mockResolvedValue([makePlayer("white"), makePlayer("black")]);
  listGames.mockResolvedValue([makeGame()]);
  listRounds.mockResolvedValue([makeRound()]);
  predictionPoints.mockResolvedValue([]);
  listMoveStampsForGames.mockResolvedValue(new Map());
});

describe("GET /api/tournament/[id] — pgn only on ?full=1 (R9)", () => {
  it("omits pgn by default (the 5s poll path)", async () => {
    const res = await GET(req("http://x/api/tournament/t1"), ctx());
    const body = (await res.json()) as { games: { pgn?: string }[] };
    expect(body.games).toHaveLength(1);
    expect(body.games[0].pgn).toBeUndefined();
  });

  it("includes pgn for decided games when ?full=1", async () => {
    const res = await GET(req("http://x/api/tournament/t1?full=1"), ctx());
    const body = (await res.json()) as { games: { pgn?: string }[] };
    expect(body.games[0].pgn).toBe("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#");
  });

  it("still omits pgn for a live game even with ?full=1", async () => {
    listGames.mockResolvedValue([makeGame({ status: "live" })]);
    const res = await GET(req("http://x/api/tournament/t1?full=1"), ctx());
    const body = (await res.json()) as { games: { pgn?: string }[] };
    expect(body.games[0].pgn).toBeUndefined();
  });

  it("does not fetch move stamps for a plain ?full=1 request without ?clocks=1", async () => {
    await GET(req("http://x/api/tournament/t1?full=1"), ctx());
    expect(listMoveStampsForGames).not.toHaveBeenCalled();
  });

  it("?clocks=1 and ?full=1 compose: clocks still attach on live games, pgn on decided ones", async () => {
    getTournament.mockResolvedValue(
      makeTournament({ config: { leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null, clockSec: 300 } }),
    );
    listRounds.mockResolvedValue([makeRound({ started_at: new Date().toISOString(), status: "live" })]);
    listGames.mockResolvedValue([
      makeGame({ id: "live1", status: "live", pgn: "" }),
      makeGame({ id: "done1", status: "draw" }),
    ]);
    const res = await GET(req("http://x/api/tournament/t1?clocks=1&full=1"), ctx());
    const body = (await res.json()) as {
      games: { id: string; pgn?: string; clock?: unknown }[];
    };
    const live = body.games.find((g) => g.id === "live1");
    const done = body.games.find((g) => g.id === "done1");
    expect(live?.clock).toBeTruthy();
    expect(live?.pgn).toBeUndefined();
    expect(done?.pgn).toBe("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#");
  });
});
