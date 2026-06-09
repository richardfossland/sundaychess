import { getGame, getPlayer } from "@/lib/server/store";
import { lastMoveFromPgn } from "@/lib/chess/lastMove";
import { fail, ok } from "@/lib/server/http";
import type { GameDetail } from "@/lib/dto";

// GET /api/game/[id] — authoritative game state for reconnect/resume (spec §4).
// Public: contains no secrets (no resume codes).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const game = await getGame(id);
  if (!game) return fail(404, "no_game");

  const [white, black] = await Promise.all([
    getPlayer(game.white_player_id),
    game.black_player_id ? getPlayer(game.black_player_id) : Promise.resolve(null),
  ]);

  const detail: GameDetail = {
    id: game.id,
    tournamentId: game.tournament_id,
    roundId: game.round_id,
    fen: game.fen,
    pgn: game.pgn,
    status: game.status,
    turn: game.turn,
    white: { id: game.white_player_id, name: white?.display_name ?? "?" },
    black: black ? { id: black.id, name: black.display_name } : null,
    lastMove: lastMoveFromPgn(game.pgn),
  };
  return ok(detail);
}
