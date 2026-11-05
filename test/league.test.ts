import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Round, Tournament } from "@/lib/types";

// Mock the DB + side-effect boundary; keep the REAL pair() + scoring. Verifies
// the round-lifecycle branching for §6 (advance to next league round vs finish).
// vi.hoisted ensures the mock vars exist before the hoisted vi.mock factories.
const { store, maybeStartPlayoff, afterGameResolved } = vi.hoisted(() => ({
  store: {
    listRounds: vi.fn(),
    setRoundStatus: vi.fn(),
    listPlayers: vi.fn(),
    listGames: vi.fn(),
    listGamesForRound: vi.fn(),
    startRoundRpc: vi.fn(),
    resolveGameRpc: vi.fn(),
    recomputeScores: vi.fn(),
    updateTournament: vi.fn(),
  },
  maybeStartPlayoff: vi.fn(),
  afterGameResolved: vi.fn(),
}));

vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/gameEvents", () => ({ afterGameResolved }));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("@/lib/server/playoff", () => ({ maybeStartPlayoff }));

import { advanceRound, currentRoundResolved, forceResolveRound, startLeague } from "@/lib/server/league";

function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: "t",
    join_pin: "000000",
    host_code: "AAAA-AA",
    host_user_id: null,
    title: null,
    status: "league",
    config: { leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 1,
    created_at: "",
    ...over,
  };
}
function players(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    tournament_id: "t",
    display_name: `P${i + 1}`,
    resume_code: "AAAA-AA",
    score: 0,
    tiebreak: 0,
    status: "active" as const,
    seed: null,
    joined_at: "",
  }));
}
const round = (number: number): Round => ({
  id: `r${number}`,
  tournament_id: "t",
  number,
  phase: "league",
  status: "live",
  started_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  store.startRoundRpc.mockResolvedValue({ ok: true, roundId: "r99" });
  store.listPlayers.mockResolvedValue(players(4));
  store.listGames.mockResolvedValue([]);
  store.listRounds.mockResolvedValue([]);
});

describe("startLeague", () => {
  it("pairs round 1 and flips status to league", async () => {
    await startLeague(tournament({ status: "lobby", current_round: 0 }));
    // 4 players → 2 games, runde + status "league" + current_round i ÉN atomisk RPC.
    expect(store.startRoundRpc).toHaveBeenCalledOnce();
    const a = store.startRoundRpc.mock.calls[0][0];
    expect(a).toMatchObject({ tournamentId: "t", number: 1, phase: "league", setStatus: "league" });
    expect(a.games).toHaveLength(2);
    expect(store.updateTournament).not.toHaveBeenCalled();
  });
});

describe("advanceRound", () => {
  it("pairs the next league round when rounds remain", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    const status = await advanceRound(tournament({ current_round: 1 }));
    expect(status).toBe("league");
    // forrige runde -> done skjer INNE i den atomiske RPC-en, ikke som egen skriving
    expect(store.startRoundRpc.mock.calls[0][0]).toMatchObject({
      number: 2, phase: "league", prevRoundId: "r1",
    });
    expect(store.setRoundStatus).not.toHaveBeenCalled();
    expect(store.updateTournament).not.toHaveBeenCalled();
    expect(maybeStartPlayoff).not.toHaveBeenCalled();
  });

  it("dobbeltklikk: en HEL runde finnes allerede -> ok, uten ny kringkasting", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.startRoundRpc.mockResolvedValue({ ok: false, conflict: "exists", complete: true });
    expect(await advanceRound(tournament({ current_round: 1 }))).toBe("league");
  });

  it("en halvbygd runde (ikke komplett) gir ærlig feil, ikke stille suksess", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.startRoundRpc.mockResolvedValue({ ok: false, conflict: "exists", complete: false });
    await expect(advanceRound(tournament({ current_round: 1 }))).rejects.toThrow("round_incomplete");
  });

  it("RPC-feil midt i opprettelsen propagerer (ingen delvis runde, ingen current_round-bump)", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.startRoundRpc.mockRejectedValue(new Error("worker died"));
    await expect(advanceRound(tournament({ current_round: 1 }))).rejects.toThrow("worker died");
    expect(store.updateTournament).not.toHaveBeenCalled();
    expect(store.setRoundStatus).not.toHaveBeenCalled();
  });

  it("finishes after the last round when no playoff", async () => {
    store.listRounds.mockResolvedValue([round(3)]);
    maybeStartPlayoff.mockResolvedValue(false);
    const status = await advanceRound(tournament({ current_round: 3 }));
    expect(status).toBe("finished");
    expect(maybeStartPlayoff).toHaveBeenCalledOnce();
    expect(store.updateTournament).toHaveBeenCalledWith("t", { status: "finished" });
  });

  it("transitions to playoff after the last round when configured", async () => {
    store.listRounds.mockResolvedValue([round(3)]);
    maybeStartPlayoff.mockResolvedValue(true);
    const status = await advanceRound(
      tournament({
        current_round: 3,
        config: { leagueRounds: 3, playoff: true, playoffSize: 4, roundTimerSec: null },
      }),
    );
    expect(status).toBe("playoff");
  });

  it("finishes instead of pairing an empty round when <2 active remain", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.listPlayers.mockResolvedValue(players(1)); // everyone else left
    const status = await advanceRound(tournament({ current_round: 1 }));
    expect(status).toBe("finished");
    expect(store.updateTournament).toHaveBeenCalledWith("t", { status: "finished" });
    expect(store.startRoundRpc).not.toHaveBeenCalled(); // no empty round created
  });
});

describe("currentRoundResolved", () => {
  it("is false for an empty (0-game) round (not vacuously resolved)", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.listGamesForRound.mockResolvedValue([]);
    expect(await currentRoundResolved(tournament({ current_round: 1 }))).toBe(false);
  });

  it("is true when the round has games and none are live", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.listGamesForRound.mockResolvedValue([{ status: "white_win" }, { status: "bye" }]);
    expect(await currentRoundResolved(tournament({ current_round: 1 }))).toBe(true);
  });
});

describe("forceResolveRound (M4)", () => {
  const live = (id: string) => ({ id, status: "live", white_player_id: "a", black_player_id: "b" });

  it("kaller resolve_game med requireLive=true og hopper over etterbehandling for avvist parti", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.listGamesForRound.mockResolvedValue([live("g1"), live("g2")]);
    // g1 ble ferdigspilt mellom lesing og force (not_live); g2 settes til remis.
    store.resolveGameRpc
      .mockResolvedValueOnce({ ok: false, conflict: "not_live" })
      .mockResolvedValueOnce({ ok: true, status: "draw" });
    await forceResolveRound(tournament({ current_round: 1 }));
    expect(store.resolveGameRpc).toHaveBeenNthCalledWith(1, "g1", "draw", "timeout_draw", true);
    expect(store.resolveGameRpc).toHaveBeenNthCalledWith(2, "g2", "draw", "timeout_draw", true);
    expect(afterGameResolved).toHaveBeenCalledTimes(1);
    expect(afterGameResolved.mock.calls[0][0]).toMatchObject({ id: "g2" });
  });

  it("recompute kjøres ikke når ingen parti ble løst", async () => {
    store.listRounds.mockResolvedValue([round(1)]);
    store.listGamesForRound.mockResolvedValue([live("g1")]);
    store.resolveGameRpc.mockResolvedValue({ ok: false, conflict: "not_live" });
    await forceResolveRound(tournament({ current_round: 1 }));
    expect(afterGameResolved).not.toHaveBeenCalled();
    expect(store.recomputeScores).not.toHaveBeenCalled();
  });
});
