import { beforeEach, describe, expect, it, vi } from "vitest";
import { Chess } from "chess.js";
import type { Game, Player } from "@/lib/types";

const { store } = vi.hoisted(() => ({
  store: {
    getGame: vi.fn(),
    getPlayer: vi.fn(),
  },
}));
const authPlayer = vi.fn();
const narrateReview = vi.fn();

vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/auth", () => ({ authPlayer: (...a: unknown[]) => authPlayer(...a) }));
vi.mock("@/lib/server/llm", () => ({ narrateReview: (...a: unknown[]) => narrateReview(...a) }));

import { POST } from "@/app/api/review/route";

function scholarMatePgn(): string {
  const chess = new Chess();
  ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"].forEach((m) => chess.move(m));
  chess.header("Result", "1-0");
  return chess.pgn();
}

function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: "g1",
    tournament_id: "t",
    round_id: "r",
    white_player_id: "white",
    black_player_id: "black",
    fen: "",
    pgn: scholarMatePgn(),
    status: "white_win",
    result_source: "play",
    turn: "w",
    draw_offered_by: null,
    updated_at: "",
    ...over,
  };
}
const player = (id: string): Player => ({
  id,
  tournament_id: "t",
  display_name: id,
  resume_code: "AAAA-AA",
  score: 0,
  tiebreak: 0,
  status: "active",
  seed: null,
  joined_at: "",
});
function req(body: unknown): Request {
  return new Request("http://x/api/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authPlayer.mockResolvedValue(player("white"));
  store.getGame.mockResolvedValue(makeGame());
  store.getPlayer.mockImplementation(async (id: string) => player(id));
  narrateReview.mockResolvedValue(null); // default: keyless → templated fallback
});

describe("POST /api/review", () => {
  it("401 when unauthorized", async () => {
    authPlayer.mockResolvedValue(null);
    const res = await POST(req({ playerId: "white", resumeCode: "x", gameId: "g1" }));
    expect(res.status).toBe(401);
  });

  it("403 when the game belongs to another tournament", async () => {
    store.getGame.mockResolvedValue(makeGame({ tournament_id: "other" }));
    const res = await POST(req({ playerId: "white", resumeCode: "x", gameId: "g1" }));
    expect(res.status).toBe(403);
  });

  it("403 when the player is not in the game", async () => {
    authPlayer.mockResolvedValue(player("stranger"));
    const res = await POST(req({ playerId: "stranger", resumeCode: "x", gameId: "g1" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_your_game");
  });

  it("409 when the game is not finished", async () => {
    store.getGame.mockResolvedValue(makeGame({ status: "live" }));
    const res = await POST(req({ playerId: "white", resumeCode: "x", gameId: "g1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_finished");
  });

  it("409 when there are no replayable moves", async () => {
    store.getGame.mockResolvedValue(makeGame({ pgn: '[Result "1-0"]', status: "white_win" }));
    const res = await POST(req({ playerId: "white", resumeCode: "x", gameId: "g1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_moves");
  });

  it("returns the templated summary when there is no key (narrate → null)", async () => {
    const res = await POST(req({ playerId: "white", resumeCode: "x", gameId: "g1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aiNarrated).toBe(false);
    expect(typeof body.summary).toBe("string");
    expect(body.summary.length).toBeGreaterThan(20);
    // engine-derived: white delivered the Scholar's mate
    expect(body.facts.deliveredMate).toBe(true);
    expect(body.facts.outcome).toBe("won");
    expect(Array.isArray(body.moves)).toBe(true);
  });

  it("uses the AI narration when present and flags aiNarrated", async () => {
    narrateReview.mockResolvedValue("Strålende avslutning, white!");
    const res = await POST(req({ playerId: "white", resumeCode: "x", gameId: "g1" }));
    const body = await res.json();
    expect(body.aiNarrated).toBe(true);
    expect(body.summary).toBe("Strålende avslutning, white!");
  });

  it("reviews from the black player's perspective (engine truth, not the LLM)", async () => {
    authPlayer.mockResolvedValue(player("black"));
    const res = await POST(req({ playerId: "black", resumeCode: "x", gameId: "g1" }));
    const body = await res.json();
    expect(body.facts.outcome).toBe("lost"); // black got mated
    expect(body.facts.deliveredMate).toBe(false);
  });
});
