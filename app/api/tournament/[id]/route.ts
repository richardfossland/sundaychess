import {
  getTournament,
  listGames,
  listPlayers,
  listRounds,
  predictionPoints,
} from "@/lib/server/store";
import { maybeAutoFinishStale } from "@/lib/server/lifecycle";
import { computeScores, computeStandings } from "@/lib/tournament/score";
import { fail, ok } from "@/lib/server/http";
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
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const t0 = await getTournament(id);
  if (!t0) return fail(404, "not_found");

  const [players, games, rounds, tipping] = await Promise.all([
    listPlayers(id),
    listGames(id),
    listRounds(id),
    predictionPoints(id).catch(() => []), // empty until 0005 is migrated
  ]);

  // Auto-close a tournament left running and then abandoned (e.g. overnight) so
  // it can't be re-entered as a zombie live board. Reuses the games we just
  // fetched; no-op for lobby/finished or still-active tournaments.
  const t = await maybeAutoFinishStale(t0, games);

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

  const state: BoardState = {
    tournament: toBoardTournament(t),
    players: players.map((p) => ({
      ...toPublicPlayer(p),
      score: leagueScore.get(p.id) ?? 0,
    })),
    games: games.map(toPublicGame),
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
