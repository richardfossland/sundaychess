import {
  getTournament,
  listGames,
  listMoveStampsForGames,
  listPlayers,
  listRounds,
  predictionPoints,
} from "@/lib/server/store";
import { computeClocks } from "@/lib/chess/clock";
import { computeScores, computeStandings } from "@/lib/tournament/score";
import { fail, ok } from "@/lib/server/http";
import type { PublicGame } from "@/lib/dto";
import {
  toBoardTournament,
  toPublicGame,
  toPublicPlayer,
  type BoardState,
} from "@/lib/dto";

// GET /api/tournament/[id] — authoritative board state (no secrets).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return await handleGet(req, ctx);
  } catch (err) {
    console.error("[tournament/[id]]", err);
    return fail(503, "server_error");
  }
}

async function handleGet(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  // Live-grid clocks are only rendered by the host projector, which asks for
  // them with ?clocks=1. Students poll this same endpoint every 5s and don't
  // show grid clocks, so we skip the per-game move-stamp read for them. (Auto-
  // finish of a stale tournament happens in /api/resume — the student entry
  // point — plus the nightly cron, so it's NOT on this hot poll path.)
  const wantClocks = new URL(req.url).searchParams.get("clocks") === "1";

  const t = await getTournament(id);
  if (!t) return fail(404, "not_found");

  const [players, games, rounds, tipping] = await Promise.all([
    listPlayers(id),
    listGames(id),
    listRounds(id),
    predictionPoints(id).catch(() => []), // empty until 0005 is migrated
  ]);

  // Standings = the LEAGUE table. Once the playoff starts, knockout games must
  // not pollute league scores/Buchholz/podium (the bracket is shown separately).
  // Pure-cup tournaments (no league rounds) keep all games so they aren't blanked.
  const leagueRoundIds = new Set(
    rounds.filter((r) => r.phase === "league").map((r) => r.id),
  );
  const standingsGames =
    leagueRoundIds.size > 0
      ? games.filter((g) => leagueRoundIds.has(g.round_id))
      : games;

  // Surface each player's LEAGUE score so team standings (which sum member
  // scores client-side) aren't inflated by playoff games. Individual standings
  // are computed from games below; the raw DB players.score (all phases) is no
  // longer read by any UI.
  const leagueScore = computeScores(standingsGames);

  // Clocks for the live-games grid: only when the host asks (?clocks=1), only
  // for a timed (lyn/blitz) tournament, and only LIVE games. ONE batched
  // move-stamp query for all live games (not one per game). The live spectate
  // channel keeps these ticking between polls.
  const clockByGame = new Map<string, NonNullable<PublicGame["clock"]>>();
  const clockSec = t.config.clockSec ?? null;
  if (wantClocks && clockSec) {
    const roundById = new Map(rounds.map((r) => [r.id, r]));
    const liveTimed = games.filter((g) => g.status === "live");
    const stampsByGame = await listMoveStampsForGames(liveTimed.map((g) => g.id));
    for (const g of liveTimed) {
      const round = roundById.get(g.round_id);
      if (!round?.started_at) continue;
      const snap = computeClocks({
        clockSec,
        startedAt: round.started_at,
        moves: stampsByGame.get(g.id) ?? [],
        turn: g.turn,
        now: new Date(),
        running: true,
      });
      clockByGame.set(g.id, {
        whiteMs: snap.whiteMs,
        blackMs: snap.blackMs,
        turn: g.turn,
        running: true,
      });
    }
  }

  const state: BoardState = {
    tournament: toBoardTournament(t),
    players: players.map((p) => ({
      ...toPublicPlayer(p),
      score: leagueScore.get(p.id) ?? 0,
    })),
    games: games.map((g) => {
      const pub = toPublicGame(g);
      const clock = clockByGame.get(g.id);
      return clock ? { ...pub, clock } : pub;
    }),
    standings: computeStandings(players, standingsGames),
    rounds: rounds.map((r) => ({
      id: r.id,
      number: r.number,
      phase: r.phase,
      status: r.status,
      startedAt: r.started_at,
      extendedMs: r.extended_ms ?? 0,
    })),
    tipping,
  };
  return ok(state);
}
