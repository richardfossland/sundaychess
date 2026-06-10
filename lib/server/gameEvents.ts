import "server-only";

import { recomputeScores } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import type { Game, GameStatus, ResultSource, Turn } from "@/lib/types";

/** Broadcast that a position changed on a game channel (after a move). */
export async function broadcastPosition(
  gameId: string,
  fen: string,
  turn: Turn,
  status: GameStatus,
  lastMove: { from: string; to: string; san: string } | null,
): Promise<void> {
  await broadcast(channels.game(gameId), events.position, {
    fen,
    turn,
    status,
    lastMove,
  });
}

/** Broadcast a move to the tournament-wide spectate feed so the teacher's
 * live-games grid updates instantly without polling every game channel. */
export async function broadcastSpectate(
  tournamentId: string,
  gameId: string,
  fen: string,
  turn: Turn,
  status: GameStatus,
): Promise<void> {
  await broadcast(channels.spectate(tournamentId), events.position, {
    gameId,
    fen,
    turn,
    status,
  });
}

/** Side-effects when a game reaches a terminal status: refresh the cached
 * scores and nudge both the game channel (players) and the lobby channel
 * (board standings + "neste runde" availability). */
export async function afterGameResolved(
  game: Pick<Game, "id" | "tournament_id">,
  status: GameStatus,
  resultSource: ResultSource,
): Promise<void> {
  await recomputeScores(game.tournament_id);
  await Promise.all([
    broadcast(channels.game(game.id), events.result, {
      gameId: game.id,
      status,
      resultSource,
    }),
    broadcast(channels.lobby(game.tournament_id), events.tournament, {
      gameResolved: game.id,
    }),
  ]);
}
