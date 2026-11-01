import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/store", async () => await import("./helpers/memoryStore"));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn(async () => {}) }));
vi.mock("@/lib/server/gameEvents", () => ({ afterGameResolved: vi.fn() }));
const budget = vi.hoisted(() => ({ blocked: false }));
vi.mock("@/lib/server/attempts", () => ({
  isCodeBlocked: vi.fn(async () => false),
  registerCodeFailure: vi.fn(async () => budget.blocked),
}));
const hostMock = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/server/auth", async () => {
  const mem = await import("./helpers/memoryStore");
  return {
    getHost: async () => hostMock.user,
    authHost: async (id: string, code: string) => {
      const t = await mem.getTournament(id);
      return t && t.host_code === code ? t : null;
    },
  };
});

import { POST as fromPhysical } from "@/app/api/tournament/from-physical/route";
import { POST as joinNames } from "@/app/api/join/names/route";
import { POST as joinClaim } from "@/app/api/join/claim/route";
import { POST as joinFresh } from "@/app/api/join/route";
import { POST as resetClaimRoute } from "@/app/api/lobby/reset-claim/route";
import { __mem, __resetMem, resolveGameRpc } from "./helpers/memoryStore";
import { advanceRound, currentRoundResolved, enginePairings, startLeague } from "@/lib/server/league";
import { __resetRateLimiter } from "@/lib/server/http";
import { buildDigitalPlan, continueRefusal } from "@/lib/physical/toDigital";
import { buildPhysicalFromDigital } from "@/lib/physical/fromDigital";
import { createTournament, dispatch, replay } from "@/lib/physical/reducer";
import { nextRoundPairing, pairNextRound, standings } from "@/lib/physical/selectors";
import { tournamentFileText } from "@/lib/export/json";
import { parseTournamentFile } from "@/lib/import/parse";
import { computeStandings, gamesToHistory, metBeforeSet, standingsOptions } from "@/lib/tournament/score";
import { TIEBREAK_KEYS } from "@/lib/tournament/tiebreaks";
import type { PhysicalSettings, PhysicalTournament, ResultCode } from "@/lib/physical/schema";
import type { Tournament } from "@/lib/types";

const PID = "11111111-2222-4333-8444-555555555555";
const NAMES = ["Anna", "Bjørn", "Cecilie", "David", "Eva", "Finn", "Gro"];
const CODES: ResultCode[] = ["1-0", "½-½", "0-1", "+-", "½-½", "-+", "1-0", "="];

function settings(over: Partial<PhysicalSettings> = {}): PhysicalSettings {
  return { system: "monrad", rounds: 4, tiebreaks: [...TIEBREAK_KEYS], byePoints: 1, allowLateEntry: true, groupLabel: "Klasse", ...over };
}
function roster(over: Partial<PhysicalSettings> = {}, n = 7): PhysicalTournament {
  let t = createTournament({ id: PID, title: "Skolemesterskap", settings: settings(over) });
  NAMES.slice(0, n).forEach((name, i) => {
    t = dispatch(t, { type: "addPlayer", playerId: `p-${name}`, name, rating: 1000 + i * 41, club: `5${"AB"[i % 2]}` });
  });
  return t;
}
function playRound(t: PhysicalTournament, offset = 0): PhysicalTournament {
  t = pairNextRound(t);
  const r = t.rounds[t.rounds.length - 1];
  t = dispatch(t, { type: "publishRound", round: r.number });
  let i = offset;
  for (const p of r.pairings) if (p.black !== null) t = dispatch(t, { type: "setResult", round: r.number, board: p.board, result: CODES[i++ % CODES.length] });
  return dispatch(t, { type: "completeRound", round: r.number });
}
/** Two completed rounds incl. a withdrawal, a walkover and a late entrant with ½ for missed rounds. */
function twoRounds(over: Partial<PhysicalSettings> = {}): PhysicalTournament {
  let t = playRound(roster(over));
  t = dispatch(t, { type: "withdrawPlayer", playerId: "p-Gro" });
  t = dispatch(t, { type: "addPlayer", playerId: "p-Hanne", name: "Hanne", rating: 1200, club: "5A", missedRoundPoints: 0.5 });
  return playRound(t, 3);
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function continueDigitally(t: PhysicalTournament) {
  const res = await fromPhysical(post("http://x/api/tournament/from-physical", { events: t.events }));
  expect(res.status).toBe(201);
  const out = (await res.json()) as { id: string; joinPin: string; hostCode: string; pairToken: string | null };
  return { out, dt: __mem.tournaments.find((x) => x.id === out.id)! };
}

function digitalRows(dt: Tournament) {
  const players = __mem.players.filter((p) => p.tournament_id === dt.id);
  const rounds = __mem.rounds.filter((r) => r.tournament_id === dt.id);
  const games = __mem.games.filter((g) => g.tournament_id === dt.id);
  return { players, rounds, games, rows: computeStandings(players, games, standingsOptions(dt.config, rounds)) };
}

/** physical standings == digital standings for every player still active (values, order). */
function expectEqualStandings(phys: PhysicalTournament, dt: Tournament) {
  const { players, rows } = digitalRows(dt);
  const byName = new Map(players.map((p) => [p.display_name, p]));
  const pr = standings(phys).filter((r) => r.player.status === "active");
  expect(rows).toHaveLength(pr.length);
  for (const r of pr) {
    const d = rows.find((x) => x.playerId === byName.get(r.player.name)!.id)!;
    expect(d, r.player.name).toBeTruthy();
    expect(d.score).toBe(r.score);
    for (const k of TIEBREAK_KEYS) {
      const dv = d.tiebreaks?.[k] ?? null;
      expect(dv === null ? null : Number(dv.toFixed(6)), `${r.player.name} ${k}`).toBe(r.values[k] === null ? null : Number(r.values[k]!.toFixed(6)));
    }
  }
  for (const a of pr)
    for (const b of pr)
      if (a.rank < b.rank) {
        const ia = rows.findIndex((x) => x.playerId === byName.get(a.player.name)!.id);
        const ib = rows.findIndex((x) => x.playerId === byName.get(b.player.name)!.id);
        expect(ia, `${a.player.name} before ${b.player.name}`).toBeLessThan(ib);
      }
}

async function playDigitalRound(dt: Tournament, pick: (i: number) => "white_win" | "black_win" | "draw") {
  const cur = __mem.tournaments.find((x) => x.id === dt.id)!;
  const live = __mem.games.filter((g) => g.tournament_id === dt.id && g.status === "live");
  let i = 0;
  for (const g of live) await resolveGameRpc(g.id, pick(i++), "play");
  expect(await currentRoundResolved(cur)).toBe(true);
}

beforeEach(() => {
  __resetMem();
  __resetRateLimiter();
  budget.blocked = false;
  hostMock.user = null;
});

describe("POST /api/tournament/from-physical", () => {
  it("creates a lobby tournament with the roster, rounds and result-only games", async () => {
    const t = twoRounds();
    const { out, dt } = await continueDigitally(t);
    expect(out.joinPin).toMatch(/^\d{6}$/);
    expect(out.hostCode).toBeTruthy();
    expect(dt.status).toBe("lobby");
    expect(dt.current_round).toBe(2);
    expect(dt.config).toMatchObject({ leagueRounds: 4, pairingSystem: "monrad", fromPhysical: { sourceId: PID, groupLabel: "Klasse" } });
    const { players, rounds, games } = digitalRows(dt);
    expect(players).toHaveLength(8);
    expect(players.find((p) => p.display_name === "Gro")!.status).toBe("left");
    expect(players.every((p) => p.pre_registered && !p.claimed_at && p.start_no)).toBe(true);
    expect(players.find((p) => p.display_name === "Anna")).toMatchObject({ rating: 1000, club: "5A", start_no: 1 });
    expect(rounds.map((r) => [r.number, r.status])).toEqual([[1, "done"], [2, "done"]]);
    expect(games.every((g) => g.pgn === "" && g.status !== "live")).toBe(true);
    expect(games.some((g) => g.result_source === "walkover")).toBe(true);
    expect(games.some((g) => g.result_source === "physical")).toBe(true);
  });

  it("stamps the signed-in Sunday Account host as owner", async () => {
    hostMock.user = { id: "user-1", email: "a@b.no" };
    const { dt } = await continueDigitally(twoRounds());
    expect(dt.host_user_id).toBe("user-1");
  });

  it("digital standings (all tiebreaks, ½/0 byes, forfeits, ratings) equal the physical ones", async () => {
    for (const system of ["monrad", "swiss"] as const) {
      __resetMem();
      const t = twoRounds({ system });
      const { dt } = await continueDigitally(t);
      expectEqualStandings(t, dt);
    }
  });

  it("equality also holds with a ½-point automatic bye and requested byes", async () => {
    let t = roster({ byePoints: 0.5 }, 5);
    t = dispatch(t, { type: "requestBye", playerId: "p-Eva", round: 1, byeType: "zero" });
    t = playRound(t);
    t = dispatch(t, { type: "requestBye", playerId: "p-Anna", round: 2, byeType: "half" });
    t = playRound(t, 2);
    const { dt } = await continueDigitally(t);
    expectEqualStandings(t, dt);
  });

  it("refuses: knockout, round in progress, nothing left, no players", async () => {
    const ko = dispatch(roster({ system: "knockout" }, 4), { type: "addPlayer", playerId: "x", name: "X" });
    expect(continueRefusal(ko)).toBe("knockout");
    let res = await fromPhysical(post("http://x/a", { events: ko.events }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "knockout" });

    let open = pairNextRound(roster());
    res = await fromPhysical(post("http://x/a", { events: open.events }));
    expect(await res.json()).toMatchObject({ error: "roundOpen" });
    open = dispatch(open, { type: "publishRound", round: 1 });
    expect((await fromPhysical(post("http://x/a", { events: open.events }))).status).toBe(409);

    let done = roster({ rounds: 1 });
    done = playRound(done);
    expect(await (await fromPhysical(post("http://x/a", { events: done.events }))).json()).toMatchObject({ error: "noRoundsLeft" });

    const many = roster({ rounds: 9 });
    expect(await (await fromPhysical(post("http://x/a", { events: many.events }))).json()).toMatchObject({ error: "tooManyRounds" });
  });

  it("caps: raw body size first, then event count, then budget, then replay", async () => {
    const big = await fromPhysical(post("http://x/a", { events: [], pad: "x".repeat(600 * 1024) }));
    expect(big.status).toBe(413);
    const many = await fromPhysical(post("http://x/a", { events: Array.from({ length: 5001 }, () => ({})) }));
    expect(many.status).toBe(422);
    expect(await many.json()).toMatchObject({ error: "too_many_events" });
    expect((await fromPhysical(post("http://x/a", { events: "no" }))).status).toBe(400);
    expect((await fromPhysical(post("http://x/a", { events: [{ type: "setResult" }] }))).status).toBe(422);
    budget.blocked = true;
    expect((await fromPhysical(post("http://x/a", { events: twoRounds().events }))).status).toBe(429);
  });

  it("a tampered log (result on an unpublished round) is rejected by the replay", async () => {
    const t = pairNextRound(roster());
    const bad = [...t.events, { ...t.events[0], id: "zz", type: "setResult", round: 1, board: 1, result: "1-0" }];
    expect((await fromPhysical(post("http://x/a", { events: bad }))).status).toBe(422);
    expect(__mem.tournaments).toHaveLength(0);
  });
});

describe("league pairing after a physical start", () => {
  it("pairs round 3 via the configured system, no rematches of physical games", async () => {
    for (const system of ["monrad", "swiss"] as const) {
      __resetMem();
      const t = twoRounds({ system });
      const { dt } = await continueDigitally(t);
      await startLeague(dt);
      const { games, rounds } = digitalRows(dt);
      expect(dt.status).toBe("league");
      expect(dt.current_round).toBe(3);
      const r3 = rounds.find((r) => r.number === 3)!;
      const prev = new Set(metBeforeSet(games.filter((g) => g.round_id !== r3.id)));
      const fresh = games.filter((g) => g.round_id === r3.id && g.black_player_id);
      expect(fresh.length).toBeGreaterThan(0);
      for (const g of fresh) {
        const [a, b] = [g.white_player_id, g.black_player_id!].sort();
        expect(prev.has(`${a}|${b}`), system).toBe(false);
      }
      // the withdrawn player is not paired
      const gro = __mem.players.find((p) => p.display_name === "Gro")!.id;
      expect(games.filter((g) => g.round_id === r3.id).some((g) => g.white_player_id === gro || g.black_player_id === gro)).toBe(false);
    }
  });

  it("a forfeit does not count as a meeting; a played game does", async () => {
    for (const code of ["+-", "1-0"] as ResultCode[]) {
      __resetMem();
      let t = createTournament({ id: PID, title: "To", settings: settings({ rounds: 2, allowLateEntry: false }) });
      for (const n of ["A", "B"]) t = dispatch(t, { type: "addPlayer", playerId: `p-${n}`, name: n });
      t = pairNextRound(t);
      t = dispatch(t, { type: "publishRound", round: 1 });
      t = dispatch(t, { type: "setResult", round: 1, board: 1, result: code });
      t = dispatch(t, { type: "completeRound", round: 1 });
      const { dt } = await continueDigitally(t);
      const players = __mem.players.filter((p) => p.tournament_id === dt.id);
      const games = __mem.games.filter((g) => g.tournament_id === dt.id);
      const rounds = __mem.rounds.filter((r) => r.tournament_id === dt.id);
      const hist = gamesToHistory(games, rounds);
      expect(hist[0].forfeit === true).toBe(code === "+-");
      const [g] = enginePairings(dt, players, games, rounds, 2);
      expect(g.black).not.toBeNull(); // only possible pairing either way
      const out = (await import("@/lib/tournament/pairing")).pairRound("monrad", {
        players: players.map((p) => ({ id: p.id, startNo: p.start_no!, score: 0, status: "active" as const })),
        history: hist,
        round: 2,
      });
      expect(!!out.pairings[0].rematch).toBe(code === "1-0");
    }
  });

  it("plays on digitally to the end, then exports a file that re-imports with equal standings", async () => {
    const t = twoRounds();
    const { dt } = await continueDigitally(t);
    await startLeague(dt);
    await playDigitalRound(dt, (i) => (["white_win", "draw", "black_win"] as const)[i % 3]);
    expect(await advanceRound(dt)).toBe("league");
    await playDigitalRound(dt, (i) => (["black_win", "white_win", "draw"] as const)[i % 3]);
    expect(await advanceRound(dt)).toBe("finished");
    expect(dt.status).not.toBe("lobby");

    const { players, rounds, games } = digitalRows(dt);
    const built = buildPhysicalFromDigital({
      tournament: { id: dt.id, title: dt.title, status: "finished", config: dt.config },
      players: players.map((p) => ({ id: p.id, displayName: p.display_name, status: p.status, rating: p.rating, club: p.club, startNo: p.start_no })),
      rounds,
      games: games.map((g) => ({ roundId: g.round_id, whitePlayerId: g.white_player_id, blackPlayerId: g.black_player_id, status: g.status, slot: g.slot, resultSource: g.result_source ?? undefined })),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.fileId).toBe(PID);
    expect(built.tournament.rounds).toHaveLength(4);
    expect(built.tournament.status).toBe("finished");

    const parsed = await parseTournamentFile(await tournamentFileText(built.tournament));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.hashOk && parsed.snapshotOk).toBe(true);
    expectEqualStandings(parsed.tournament, dt);
    expect(replay(parsed.tournament.events).rounds).toHaveLength(4);
  });

  it("export mid-way (between rounds) can be continued over the board", async () => {
    const { dt } = await continueDigitally(twoRounds());
    await startLeague(dt);
    await playDigitalRound(dt, () => "white_win");
    const { players, rounds, games } = digitalRows(dt);
    const built = buildPhysicalFromDigital({
      tournament: { id: dt.id, title: dt.title, status: "league", config: dt.config },
      players: players.map((p) => ({ id: p.id, displayName: p.display_name, status: p.status, rating: p.rating, club: p.club, startNo: p.start_no })),
      rounds,
      games: games.map((g) => ({ roundId: g.round_id, whitePlayerId: g.white_player_id, blackPlayerId: g.black_player_id, status: g.status, slot: g.slot, resultSource: g.result_source ?? undefined })),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expectEqualStandings(built.tournament, dt);
    // the next round can be paired by the physical engine
    expect(nextRoundPairing(built.tournament).round).toBe(4);
  });

  it("refuses export while a game is live and for cups/playoffs", () => {
    const base = { id: "t", title: "x", config: { leagueRounds: 3, playoff: false, playoffSize: 0 as const, roundTimerSec: null } };
    const live = buildPhysicalFromDigital({
      tournament: { ...base, status: "league" },
      players: [{ id: "a", displayName: "A", status: "active" }, { id: "b", displayName: "B", status: "active" }],
      rounds: [{ id: "r1", number: 1, phase: "league" }],
      games: [{ roundId: "r1", whitePlayerId: "a", blackPlayerId: "b", status: "live" }],
    });
    expect(live).toEqual({ ok: false, reason: "roundInProgress" });
    expect(buildPhysicalFromDigital({ tournament: { ...base, status: "playoff" }, players: [], rounds: [], games: [] })).toEqual({ ok: false, reason: "playoff" });
    expect(buildPhysicalFromDigital({ tournament: { ...base, status: "playoff", config: { ...base.config, format: "cup" } }, players: [], rounds: [], games: [] })).toEqual({ ok: false, reason: "cup" });
  });
});

describe("claiming names", () => {
  async function lobby() {
    return await continueDigitally(twoRounds());
  }
  const list = async (pin: string) => (await (await joinNames(post("http://x/n", { pin }))).json()) as { names: { id: string; displayName: string }[]; canJoinFresh: boolean };

  it("lists only unclaimed, active, pre-registered names (no secrets)", async () => {
    const { out } = await lobby();
    const l = await list(out.joinPin);
    expect(l.names.map((n) => n.displayName)).toEqual(["Anna", "Bjørn", "Cecilie", "David", "Eva", "Finn", "Hanne"]); // not Gro (left)
    expect(JSON.stringify(l)).not.toContain("resume");
    expect(l.canJoinFresh).toBe(true); // physical allowed late entry
  });

  it("claim issues the resume code once; a second claim of the same name is rejected", async () => {
    const { out } = await lobby();
    const anna = (await list(out.joinPin)).names[0];
    const a = await joinClaim(post("http://x/c", { pin: out.joinPin, playerId: anna.id }));
    expect(a.status).toBe(200);
    const body = await a.json();
    expect(body.resumeCode).toMatch(/\S+/);
    expect(body.displayName).toBe("Anna");
    const b = await joinClaim(post("http://x/c", { pin: out.joinPin, playerId: anna.id }));
    expect(b.status).toBe(409);
    expect(await b.json()).toMatchObject({ error: "already_claimed" });
    expect((await list(out.joinPin)).names.some((n) => n.id === anna.id)).toBe(false);
  });

  it("two simultaneous claims: exactly one wins", async () => {
    const { out } = await lobby();
    const bjorn = (await list(out.joinPin)).names[1];
    const rs = await Promise.all([1, 2].map(() => joinClaim(post("http://x/c", { pin: out.joinPin, playerId: bjorn.id }))));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("rejects bad pin / unknown player / non-pre-registered player", async () => {
    const { out } = await lobby();
    expect((await joinClaim(post("http://x/c", { pin: "abc", playerId: "x" }))).status).toBe(400);
    expect((await joinClaim(post("http://x/c", { pin: out.joinPin, playerId: "not-a-uuid" }))).status).toBe(400);
    expect((await joinClaim(post("http://x/c", { pin: "999999", playerId: "00000000-0000-4000-8000-000000000999" }))).status).toBe(404);
    expect((await joinClaim(post("http://x/c", { pin: out.joinPin, playerId: "00000000-0000-4000-8000-000000000999" }))).status).toBe(409);
  });

  it("host reset frees the name and rotates the resume code; needs the host code", async () => {
    const { out, dt } = await lobby();
    const anna = (await list(out.joinPin)).names[0];
    const first = await (await joinClaim(post("http://x/c", { pin: out.joinPin, playerId: anna.id }))).json();
    const no = await resetClaimRoute(post("http://x/r", { tournamentId: dt.id, hostCode: "WRONG", playerId: anna.id }));
    expect(no.status).toBe(401);
    const yes = await resetClaimRoute(post("http://x/r", { tournamentId: dt.id, hostCode: out.hostCode, playerId: anna.id }));
    expect(yes.status).toBe(200);
    const again = await (await joinClaim(post("http://x/c", { pin: out.joinPin, playerId: anna.id }))).json();
    expect(again.resumeCode).not.toBe(first.resumeCode);
  });

  it("fresh join is refused when the physical tournament did not allow late entry", async () => {
    let nl = playRound(roster({ allowLateEntry: false }));
    nl = playRound(nl, 3);
    const { out } = await continueDigitally(nl);
    expect((await list(out.joinPin)).canJoinFresh).toBe(false);
    const r = await joinFresh(post("http://x/j", { pin: out.joinPin, displayName: "Ny" }));
    expect(r.status).toBe(403);
  });
});
