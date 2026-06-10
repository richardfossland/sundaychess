import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Player } from "@/lib/types";

// Mock the DB + side-effect boundary; keep the REAL chess validation + route
// logic. This verifies the §4 wiring: auth, turn-ownership, illegal rejection,
// atomic-commit args, conflict mapping, and end-of-game side-effects.
const getGame = vi.fn();
const applyMoveRpc = vi.fn();
const authPlayer = vi.fn();
const afterGameResolved = vi.fn();
const broadcastPosition = vi.fn();
// clock path: defaults (set in beforeEach) configure no clockSec → gameClock()
// returns null and the flag-fall branch is skipped (clock logic itself is
// covered by clock.test.ts)
const getTournament = vi.fn();
const resolveGameRpc = vi.fn();
const getRound = vi.fn();
const listMoveStamps = vi.fn();

vi.mock("@/lib/server/store", () => ({
  getGame: (...a: unknown[]) => getGame(...a),
  applyMoveRpc: (...a: unknown[]) => applyMoveRpc(...a),
  resolveGameRpc: (...a: unknown[]) => resolveGameRpc(...a),
  getTournament: (...a: unknown[]) => getTournament(...a),
  getRound: (...a: unknown[]) => getRound(...a),
  listMoveStamps: (...a: unknown[]) => listMoveStamps(...a),
  setDrawOffer: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
  authPlayer: (...a: unknown[]) => authPlayer(...a),
}));
vi.mock("@/lib/server/gameEvents", () => ({
  afterGameResolved: (...a: unknown[]) => afterGameResolved(...a),
  broadcastPosition: (...a: unknown[]) => broadcastPosition(...a),
  broadcastSpectate: vi.fn(),
}));

import { POST } from "@/app/api/move/route";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: "g1",
    tournament_id: "t",
    round_id: "r",
    white_player_id: "white",
    black_player_id: "black",
    fen: START,
    pgn: "",
    status: "live",
    result_source: null,
    turn: "w",
    draw_offered_by: null,
    updated_at: "",
    ...over,
  };
}
function makePlayer(id: string): Player {
  return {
    id,
    tournament_id: "t",
    display_name: id,
    resume_code: "AAAA-AA",
    score: 0,
    tiebreak: 0,
    status: "active",
    seed: null,
    joined_at: "",
  };
}
function req(body: unknown): Request {
  return new Request("http://x/api/move", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `1.2.3.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  applyMoveRpc.mockResolvedValue({ ok: true, ply: 1, status: "live" });
  broadcastPosition.mockResolvedValue(undefined);
  afterGameResolved.mockResolvedValue(undefined);
  getTournament.mockResolvedValue({ id: "t", config: {} });
  resolveGameRpc.mockResolvedValue({ ok: true });
  getRound.mockResolvedValue({ id: "r", started_at: "2026-01-01T00:00:00Z" });
  listMoveStamps.mockResolvedValue([]);
});

describe("POST /api/move", () => {
  it("401 when the resume code does not authenticate", async () => {
    authPlayer.mockResolvedValue(null);
    const res = await POST(req({ gameId: "g1", from: "e2", to: "e4", playerId: "white", resumeCode: "x" }));
    expect(res.status).toBe(401);
  });

  it("403 when it is not the mover's turn", async () => {
    authPlayer.mockResolvedValue(makePlayer("black"));
    getGame.mockResolvedValue(makeGame({ turn: "w" })); // white to move, black asks
    const res = await POST(req({ gameId: "g1", from: "e7", to: "e5", playerId: "black", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_your_turn");
  });

  it("400 rejects an illegal move server-side", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame());
    const res = await POST(req({ gameId: "g1", from: "e2", to: "e5", playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(400);
    expect(applyMoveRpc).not.toHaveBeenCalled();
  });

  it("applies a legal move atomically and broadcasts", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame());
    const res = await POST(req({ gameId: "g1", from: "e2", to: "e4", playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.turn).toBe("b");
    expect(json.san).toBe("e4");
    // The RPC got the stored FEN as the optimistic-concurrency guard.
    expect(applyMoveRpc).toHaveBeenCalledOnce();
    expect(applyMoveRpc.mock.calls[0][0]).toMatchObject({
      gameId: "g1",
      expectedFen: START,
      byPlayerId: "white",
      newTurn: "b",
      newStatus: "live",
    });
    expect(broadcastPosition).toHaveBeenCalledOnce();
    expect(afterGameResolved).not.toHaveBeenCalled();
  });

  it("maps a stale concurrency conflict to 409", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame());
    applyMoveRpc.mockResolvedValue({ ok: false, conflict: "stale" });
    const res = await POST(req({ gameId: "g1", from: "e2", to: "e4", playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale");
  });

  it("detects checkmate and runs resolution side-effects", async () => {
    // Black to move, Qh4# (Fool's mate position after 1.f3 e5 2.g4).
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2";
    authPlayer.mockResolvedValue(makePlayer("black"));
    getGame.mockResolvedValue(makeGame({ fen, turn: "b" }));
    applyMoveRpc.mockResolvedValue({ ok: true, ply: 4, status: "black_win" });
    const res = await POST(req({ gameId: "g1", from: "d8", to: "h4", playerId: "black", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("black_win");
    expect(applyMoveRpc.mock.calls[0][0]).toMatchObject({ newStatus: "black_win" });
    expect(afterGameResolved).toHaveBeenCalledOnce();
    expect(afterGameResolved.mock.calls[0].slice(1)).toEqual(["black_win", "play"]);
  });

  it("404 when the game does not exist", async () => {
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(null);
    const res = await POST(req({ gameId: "g1", from: "e2", to: "e4", playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(404);
  });

  it("flag-fall: a flagged mover loses on time instead of moving", async () => {
    // 60s clock, round started long ago, no moves → white (to move) is flagged.
    getTournament.mockResolvedValueOnce({ id: "t", config: { clockSec: 60 } });
    authPlayer.mockResolvedValue(makePlayer("white"));
    getGame.mockResolvedValue(makeGame());
    const res = await POST(req({ gameId: "g1", from: "e2", to: "e4", playerId: "white", resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("flagged");
    expect(resolveGameRpc).toHaveBeenCalledWith("g1", "black_win", "play", true);
    expect(afterGameResolved).toHaveBeenCalledOnce();
    expect(applyMoveRpc).not.toHaveBeenCalled();
  });
});
