import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game, Player } from "@/lib/types";

// Real auth (so the uuid guard inside authPlayer is exercised), mocked store +
// clock. The clock maths itself is covered by clock.test.ts; here we only care
// that the ROUTE never turns a client error into an outage.
const getGame = vi.fn();
const getPlayer = vi.fn();
const resolveGameRpc = vi.fn();
const gameClock = vi.fn();
const afterGameResolved = vi.fn();
const broadcastPosition = vi.fn();
const broadcastSpectate = vi.fn();

const { deferred, rateLimitMock } = vi.hoisted(() => ({
  deferred: [] as Array<() => Promise<void>>,
  // H4: the per-IP gameact rate limiter, mocked so we can force a 429.
  rateLimitMock: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/server/store", () => ({
  getGame: (...a: unknown[]) => getGame(...a),
  getPlayer: (...a: unknown[]) => getPlayer(...a),
  resolveGameRpc: (...a: unknown[]) => resolveGameRpc(...a),
}));
vi.mock("@/lib/server/clock", () => ({
  gameClock: (...a: unknown[]) => gameClock(...a),
}));
vi.mock("@/lib/server/gameEvents", () => ({
  afterGameResolved: (...a: unknown[]) => afterGameResolved(...a),
  broadcastPosition: (...a: unknown[]) => broadcastPosition(...a),
  broadcastSpectate: (...a: unknown[]) => broadcastSpectate(...a),
}));
vi.mock("@/lib/server/defer", () => ({
  defer: (task: () => Promise<void>) => {
    deferred.push(task);
  },
}));
vi.mock("@/lib/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/http")>();
  return { ...actual, rateLimit: (...a: unknown[]) => rateLimitMock(...a) };
});

async function drainDeferred(): Promise<void> {
  const queue = deferred.splice(0);
  for (const task of queue) await task();
}

import { POST } from "@/app/api/game/claim/route";

const T_ID = "22222222-2222-4222-8222-222222222222";
const G_ID = "11111111-1111-4111-8111-111111111111";
const WHITE = "33333333-3333-4333-8333-333333333333";
const BLACK = "44444444-4444-4444-8444-444444444444";
// Both sides still have their queens, so winnerCanMate() is true and the claim
// resolves to a win rather than the FIDE 6.9 draw.
const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";

const game = (over: Partial<Game> = {}): Game => ({
  id: G_ID,
  tournament_id: T_ID,
  round_id: "r",
  white_player_id: WHITE,
  black_player_id: BLACK,
  fen: FEN,
  pgn: "",
  status: "live",
  result_source: null,
  turn: "b",
  draw_offered_by: null,
  updated_at: "",
  ...over,
});

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id,
  tournament_id: T_ID,
  display_name: id,
  resume_code: "AAAA-AA",
  score: 0,
  tiebreak: 0,
  status: "active",
  seed: null,
  joined_at: "",
  ...over,
});

const clockOf = (flagged: "w" | "b" | null) => ({
  snap: { whiteMs: 1000, blackMs: 0, flagged },
  info: { whiteMs: 1000, blackMs: 0, turn: "b" as const, running: true },
});

const req = (body: unknown) =>
  new Request("http://x/api/game/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { gameId: G_ID, playerId: WHITE, resumeCode: "AAAA-AA" };

beforeEach(() => {
  vi.clearAllMocks();
  deferred.length = 0;
  rateLimitMock.mockReturnValue(true);
  getGame.mockResolvedValue(game());
  getPlayer.mockImplementation(async (id: string) => player(id));
  gameClock.mockResolvedValue(clockOf("b")); // black has flagged
  resolveGameRpc.mockResolvedValue({ ok: true });
  afterGameResolved.mockResolvedValue(undefined);
  broadcastPosition.mockResolvedValue(undefined);
  broadcastSpectate.mockResolvedValue(undefined);
});

describe("POST /api/game/claim", () => {
  // H4: bounds player-action bursts per IP; checked before auth even runs.
  it("429s when the per-IP gameact bound is exceeded", async () => {
    rateLimitMock.mockReturnValueOnce(false);
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(getPlayer).not.toHaveBeenCalled();
    expect(getGame).not.toHaveBeenCalled();
  });

  it("awards the win on time and scores after responding", async () => {
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "white_win" });
    expect(resolveGameRpc).toHaveBeenCalledWith(G_ID, "white_win", "play", true);
    expect(afterGameResolved).not.toHaveBeenCalled();
    await drainDeferred();
    expect(afterGameResolved).toHaveBeenCalledOnce();
  });

  // H2: a malformed gameId is a bad body field, not an outage. Before the guard
  // a non-UUID `.eq("id", …)` threw 22P02 and the catch-all answered 503.
  it("400s JSON on a malformed gameId, without ever querying Postgres", async () => {
    const res = await POST(req({ ...good, gameId: "g1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
    expect(getGame).not.toHaveBeenCalled();
  });

  it("400 bad_request without a gameId at all", async () => {
    const res = await POST(req({ playerId: WHITE, resumeCode: "AAAA-AA" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  });

  // H2: the guard lives inside authPlayer, so a malformed playerId is a clean
  // 401 rather than a 22P02 → 503.
  it("401s JSON on a malformed playerId, without ever querying Postgres", async () => {
    const res = await POST(req({ ...good, playerId: "white" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(getPlayer).not.toHaveBeenCalled();
  });

  it("401 on a wrong resume code", async () => {
    expect((await POST(req({ ...good, resumeCode: "ZZZZ-99" }))).status).toBe(401);
  });

  it("403 when the claimer is not in this game", async () => {
    const stranger = "55555555-5555-4555-8555-555555555555";
    const res = await POST(req({ ...good, playerId: stranger }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_a_player");
  });

  it("409 not_live once the game is decided", async () => {
    getGame.mockResolvedValue(game({ status: "draw" }));
    expect((await POST(req(good))).status).toBe(409);
  });

  it("409 no_clock in an untimed tournament", async () => {
    gameClock.mockResolvedValue(null);
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_clock");
  });

  it("409 not_flagged when the OPPONENT's clock is still running", async () => {
    gameClock.mockResolvedValue(clockOf(null));
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_flagged");
    expect(resolveGameRpc).not.toHaveBeenCalled();
  });

  it("returns a structured 503 (never throws) when the game lookup fails", async () => {
    getGame.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
