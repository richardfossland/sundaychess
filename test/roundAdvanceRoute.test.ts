import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

// Verify the advance route's guards + the double-fire (23505) recovery: a second
// concurrent "Neste runde" must not 500 — the first already advanced, so answer
// 200 with the fresh status. Real auth, mocked store, so the uuid guard is
// exercised for real rather than through an authHost stub.
const getTournament = vi.fn();
const advanceRound = vi.fn();
const currentRoundResolved = vi.fn();
const advancePlayoff = vi.fn();
const playoffRoundResolved = vi.fn();

vi.mock("@/lib/server/league", () => ({
  advanceRound: (...a: unknown[]) => advanceRound(...a),
  currentRoundResolved: (...a: unknown[]) => currentRoundResolved(...a),
}));
vi.mock("@/lib/server/playoff", () => ({
  advancePlayoff: (...a: unknown[]) => advancePlayoff(...a),
  playoffRoundResolved: (...a: unknown[]) => playoffRoundResolved(...a),
}));
vi.mock("@/lib/server/store", () => ({
  getTournament: (...a: unknown[]) => getTournament(...a),
  getPlayer: vi.fn(), // imported by lib/server/auth
}));

import { POST } from "@/app/api/round/advance/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";
const HOST = "HOST-01";

const tournament = (over: Partial<Tournament> = {}): Tournament =>
  ({
    id: T_ID,
    join_pin: "123456",
    host_code: HOST,
    host_user_id: null,
    title: null,
    status: "league",
    config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 1,
    created_at: "",
    ...over,
  }) as Tournament;

const req = (body: unknown) =>
  new Request("http://x/api/round/advance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { tournamentId: T_ID, hostCode: HOST };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  getTournament.mockResolvedValue(tournament());
  currentRoundResolved.mockResolvedValue(true);
  advanceRound.mockReset();
});

describe("POST /api/round/advance", () => {
  it("401 without host auth", async () => {
    expect((await POST(req({ tournamentId: T_ID, hostCode: "ZZZZ-99" }))).status).toBe(401);
  });

  it("409 round_unresolved when the current round isn't done", async () => {
    currentRoundResolved.mockResolvedValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("round_unresolved");
  });

  it("advances normally and returns the new status", async () => {
    advanceRound.mockResolvedValue("league");
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("league");
  });

  // H1: dobbeltklikk avgjøres nå i start_round (0018); advanceRound svarer normalt
  // når en HEL runde finnes. En halvbygd runde må gi en ærlig feil, ikke 200.
  it("409 round_incomplete (ikke 200) når neste runde finnes men er halvbygd", async () => {
    advanceRound.mockRejectedValue(new Error("round_incomplete"));
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("round_incomplete");
  });

  it("en rå 23505 svares IKKE lenger som suksess", async () => {
    advanceRound.mockRejectedValue({ code: "23505" });
    const res = await POST(req(good));
    expect(res.status).toBe(500);
  });

  it("401s JSON on a malformed tournamentId, without ever querying Postgres", async () => {
    const res = await POST(req({ tournamentId: "next", hostCode: HOST }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(getTournament).not.toHaveBeenCalled();
  });

  // H1: authHost ran BEFORE the try, so a transient DB error there escaped the
  // handler and Cloudflare served an HTML 500/1102 instead of our JSON.
  it("returns a structured 503 (never throws) when the auth lookup fails", async () => {
    getTournament.mockRejectedValue(new Error("db down"));
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });
});
