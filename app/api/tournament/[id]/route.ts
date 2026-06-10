import {
  getTournament,
  listGames,
  listPlayers,
  listRounds,
  predictionPoints,
} from "@/lib/server/store";
import { computeStandings } from "@/lib/tournament/score";
import { fail, ok } from "@/lib/server/http";
import {
  toBoardTournament,
  toPublicGame,
  toPublicPlayer,
  type BoardState,
} from "@/lib/dto";

// GET /api/tournament/[id] — authoritative board state (no secrets).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const t = await getTournament(id);
  if (!t) return fail(404, "not_found");

  const [players, games, rounds, tipping] = await Promise.all([
    listPlayers(id),
    listGames(id),
    listRounds(id),
    predictionPoints(id).catch(() => []), // empty until 0005 is migrated
  ]);

  const state: BoardState = {
    tournament: toBoardTournament(t),
    players: players.map(toPublicPlayer),
    games: games.map(toPublicGame),
    standings: computeStandings(players, games),
    rounds: rounds.map((r) => ({
      id: r.id,
      number: r.number,
      phase: r.phase,
      status: r.status,
      startedAt: r.started_at,
    })),
    tipping,
  };
  return ok(state);
}
