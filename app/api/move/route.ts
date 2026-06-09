import { applyMove } from "@/lib/chess/validateMove";
import { applyMoveRpc, getGame } from "@/lib/server/store";
import { authPlayer } from "@/lib/server/auth";
import { afterGameResolved, broadcastPosition } from "@/lib/server/gameEvents";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import type { Turn } from "@/lib/types";

// POST /api/move — THE server-authoritative move path (spec §4).
export async function POST(req: Request) {
  if (!rateLimit(`move:${clientIp(req)}`, 120, 60_000)) {
    return fail(429, "rate_limited");
  }

  const body = await readJson<{
    gameId?: string;
    from?: string;
    to?: string;
    promotion?: string;
    playerId?: string;
    resumeCode?: string;
  }>(req);
  if (!body?.gameId || !body.from || !body.to) return fail(400, "bad_request");

  // 1. Authenticate the mover (resume code is a bearer token).
  const player = await authPlayer(body.playerId, body.resumeCode);
  if (!player) return fail(401, "unauthorized");

  // 2. Load authoritative game state.
  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");
  if (game.tournament_id !== player.tournament_id) return fail(403, "forbidden");
  if (game.status !== "live") return fail(409, "not_live");

  // 3. Enforce "wait your turn": the mover must own the side to move. This is
  //    the real enforcement, not just a UI hint.
  const sideOwner = game.turn === "w" ? game.white_player_id : game.black_player_id;
  if (sideOwner !== player.id) return fail(403, "not_your_turn");

  // 4. Validate legality against the stored FEN + history.
  const promotion =
    body.promotion === "q" || body.promotion === "r" ||
    body.promotion === "b" || body.promotion === "n"
      ? body.promotion
      : undefined;
  const applied = applyMove(
    game.fen,
    { from: body.from, to: body.to, promotion },
    game.pgn,
  );
  if (!applied.ok) return fail(400, applied.reason);

  // 5. Commit atomically (row lock + optimistic FEN check inside the RPC).
  const result = await applyMoveRpc({
    gameId: game.id,
    expectedFen: game.fen,
    newFen: applied.fen,
    newPgn: applied.pgn,
    san: applied.san,
    newTurn: applied.turn as Turn,
    newStatus: applied.status,
    resultSource: "play",
    byPlayerId: player.id,
  });

  if (!result.ok) {
    // A concurrent move won the race, or the game changed under us.
    const code = result.conflict ?? "conflict";
    const status =
      code === "not_your_turn" ? 403 : code === "no_game" ? 404 : 409;
    return fail(status, code);
  }

  // 6. Broadcast the new authoritative position (hint to refetch/sync).
  await broadcastPosition(game.id, applied.fen, applied.turn as Turn, applied.status, {
    from: body.from,
    to: body.to,
    san: applied.san,
  });

  // 7. If the game ended on this move, run resolution side-effects.
  if (applied.status !== "live") {
    await afterGameResolved(game, applied.status, "play");
  }

  return ok({
    fen: applied.fen,
    turn: applied.turn,
    status: applied.status,
    san: applied.san,
  });
}
