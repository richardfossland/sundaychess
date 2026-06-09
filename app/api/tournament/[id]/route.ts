import { getTournament, listGames, listPlayers } from "@/lib/server/store";
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

  const [players, games] = await Promise.all([listPlayers(id), listGames(id)]);
  const state: BoardState = {
    tournament: toBoardTournament(t),
    players: players.map(toPublicPlayer),
    games: games.map(toPublicGame),
  };
  return ok(state);
}
