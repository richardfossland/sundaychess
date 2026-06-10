import { getGame, resolveGameRpc } from "@/lib/server/store";
import { authPlayer } from "@/lib/server/auth";
import { gameClock } from "@/lib/server/clock";
import {
  afterGameResolved,
  broadcastPosition,
  broadcastSpectate,
} from "@/lib/server/gameEvents";
import { fail, ok, readJson } from "@/lib/server/http";
import type { GameStatus } from "@/lib/types";

// POST /api/game/claim — "krev seier på tid": a player claims the win when the
// OPPONENT's chess clock has run out. Server-verified against move timestamps.
export async function POST(req: Request) {
  const body = await readJson<{
    gameId?: string;
    playerId?: string;
    resumeCode?: string;
  }>(req);
  if (!body?.gameId) return fail(400, "bad_request");

  const player = await authPlayer(body.playerId, body.resumeCode);
  if (!player) return fail(401, "unauthorized");

  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");
  if (game.tournament_id !== player.tournament_id) return fail(403, "forbidden");
  if (game.status !== "live") return fail(409, "not_live");

  const isWhite = game.white_player_id === player.id;
  const isBlack = game.black_player_id === player.id;
  if (!isWhite && !isBlack) return fail(403, "not_a_player");

  const clock = await gameClock(game);
  if (!clock) return fail(409, "no_clock");

  const oppColor = isWhite ? "b" : "w";
  if (clock.snap.flagged !== oppColor) return fail(409, "not_flagged");

  const winner: GameStatus = isWhite ? "white_win" : "black_win";
  const resolved = await resolveGameRpc(game.id, winner, "play", true);
  if (!resolved.ok) return fail(409, resolved.conflict ?? "conflict");

  await afterGameResolved(game, winner, "play");
  await broadcastPosition(game.id, game.fen, game.turn, winner, null, {
    ...clock.info,
    running: false,
  });
  await broadcastSpectate(game.tournament_id, game.id, game.fen, game.turn, winner);

  return ok({ status: winner });
}
