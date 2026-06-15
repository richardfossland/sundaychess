import { applyMove } from "@/lib/chess/validateMove";
import { winnerCanMate } from "@/lib/chess/material";
import {
  applyMoveRpc,
  getGame,
  resolveGameRpc,
  setDrawOffer,
} from "@/lib/server/store";
import { authPlayer } from "@/lib/server/auth";
import { gameClock } from "@/lib/server/clock";
import {
  afterGameResolved,
  broadcastPosition,
  broadcastSpectate,
} from "@/lib/server/gameEvents";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import type { GameStatus, Turn } from "@/lib/types";

// POST /api/move — THE server-authoritative move path (spec §4).
export async function POST(req: Request) {
  try {
    return await handleMove(req);
  } catch (err) {
    // Never let an unexpected throw become a platform 500/1102 HTML page: the
    // client maps an unknown move error to a (false) "Ulovlig trekk". Return a
    // structured transient error so the client shows reconnecting + resyncs.
    console.error("[move]", err);
    return fail(503, "server_error");
  }
}

async function handleMove(req: Request): Promise<Response> {
  const body = await readJson<{
    gameId?: string;
    from?: string;
    to?: string;
    promotion?: string;
    playerId?: string;
    resumeCode?: string;
  }>(req);
  if (!body?.gameId || !body.from || !body.to) return fail(400, "bad_request");

  // Rate-limit per player, not per IP: a whole classroom shares one school
  // NAT IP, so an IP-wide cap would throttle legitimate play. The playerId is
  // unauthenticated here, but flooding random ids buys nothing — auth below
  // is the real gate; this only bounds per-student request bursts.
  if (!rateLimit(`move:${clientIp(req)}:${body.playerId ?? "anon"}`, 120, 60_000)) {
    return fail(429, "rate_limited");
  }

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

  // 3b. Chess clock (lyn/blitz): a flagged mover loses on time instead of
  //     moving. Resolved server-side so the result is authoritative.
  const clock = await gameClock(game);
  if (clock && clock.snap.flagged === game.turn) {
    const winnerColor = game.turn === "w" ? "black" : "white";
    // Win-on-time → DRAW if the winner can't possibly mate (FIDE 6.9), else win.
    const result: GameStatus = winnerCanMate(game.fen, winnerColor)
      ? winnerColor === "white"
        ? "white_win"
        : "black_win"
      : "draw";
    const resolved = await resolveGameRpc(game.id, result, "play", true);
    if (resolved.ok) {
      await afterGameResolved(game, result, "play");
      await broadcastPosition(game.id, game.fen, game.turn, result, null, {
        ...clock.info,
        running: false,
      });
      await broadcastSpectate(game.tournament_id, game.id, game.fen, game.turn, result);
    }
    return fail(409, "flagged");
  }

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

  // A move supersedes any pending draw offer.
  if (game.draw_offered_by) await setDrawOffer(game.id, null);

  // The pre-move snapshot already charged the mover up to "now", which equals
  // the post-move clock state; only the side to move flips.
  const newClock = clock
    ? {
        ...clock.info,
        turn: applied.turn as Turn,
        running: applied.status === "live",
      }
    : null;

  // 6. Broadcast the new authoritative position (hint to refetch/sync) — to the
  //    players' game channel and the teacher's tournament-wide spectate feed.
  await broadcastPosition(
    game.id,
    applied.fen,
    applied.turn as Turn,
    applied.status,
    {
      from: body.from,
      to: body.to,
      san: applied.san,
    },
    newClock,
  );
  await broadcastSpectate(
    game.tournament_id,
    game.id,
    applied.fen,
    applied.turn as Turn,
    applied.status,
  );

  // 7. If the game ended on this move, run resolution side-effects.
  if (applied.status !== "live") {
    await afterGameResolved(game, applied.status, "play");
  }

  return ok({
    fen: applied.fen,
    turn: applied.turn,
    status: applied.status,
    san: applied.san,
    clock: newClock,
  });
}
