import { authHost } from "@/lib/server/auth";
import { getGame, resolveGameRpc } from "@/lib/server/store";
import { afterGameResolved } from "@/lib/server/gameEvents";
import { defer } from "@/lib/server/defer";
import { fail, ok, readJson, withApi } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";
import type { GameStatus } from "@/lib/types";

const ALLOWED: GameStatus[] = ["white_win", "black_win", "draw", "aborted"];

// POST /api/game/override — teacher sets a game result from the board (spec §3).
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson<{
    gameId?: string;
    hostCode?: string;
    result?: GameStatus;
  }>(req);
  if (!body?.gameId || !body.result || !ALLOWED.includes(body.result)) {
    return fail(400, "bad_request");
  }
  // A malformed gameId is a client error, not an outage (22P02 → false 503).
  if (!isUuid(body.gameId)) return fail(400, "bad_request");

  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");

  const t = await authHost(game.tournament_id, body.hostCode, req);
  if (!t) return fail(401, "unauthorized");

  // A bye isn't a played game — overriding it would mis-score the bye player
  // (the absent route guards byes too). Reject rather than corrupt standings.
  if (game.status === "bye") return fail(409, "cannot_override_bye");

  const newStatus = body.result;
  const result = await resolveGameRpc(game.id, newStatus, "teacher_override");
  if (!result.ok) return fail(409, result.conflict ?? "conflict");

  // M1: the result is committed; scoring + broadcasts are a hint layer, so
  // they run after the response (see lib/server/defer.ts).
  defer(() => afterGameResolved(game, newStatus, "teacher_override"), "override");
  return ok({ status: newStatus });
}
