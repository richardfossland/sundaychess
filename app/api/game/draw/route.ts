import { getGame, resolveGameRpc } from "@/lib/server/store";
import { authPlayer } from "@/lib/server/auth";
import { afterGameResolved } from "@/lib/server/gameEvents";
import { broadcast } from "@/lib/server/broadcast";
import { channels } from "@/lib/realtime";
import { clearOffer, getOffer, setOffer } from "@/lib/server/drawOffers";
import { fail, ok, readJson } from "@/lib/server/http";

// POST /api/game/draw — draw by agreement.
//   action 'offer'   → record + broadcast an offer to the opponent
//   action 'accept'  → only valid if the OPPONENT has a pending offer → draw
//   action 'decline' → clear the offer + notify
export async function POST(req: Request) {
  const body = await readJson<{
    gameId?: string;
    playerId?: string;
    resumeCode?: string;
    action?: "offer" | "accept" | "decline";
  }>(req);
  if (!body?.gameId || !body.action) return fail(400, "bad_request");

  const player = await authPlayer(body.playerId, body.resumeCode);
  if (!player) return fail(401, "unauthorized");

  const game = await getGame(body.gameId);
  if (!game) return fail(404, "no_game");
  if (game.tournament_id !== player.tournament_id) return fail(403, "forbidden");
  if (game.status !== "live") return fail(409, "not_live");

  const isPlayer =
    game.white_player_id === player.id || game.black_player_id === player.id;
  if (!isPlayer) return fail(403, "not_a_player");

  const topic = channels.game(game.id);

  if (body.action === "offer") {
    setOffer(game.id, player.id);
    await broadcast(topic, "draw_offer", { by: player.id });
    return ok({ offered: true });
  }

  if (body.action === "decline") {
    clearOffer(game.id);
    await broadcast(topic, "draw_declined", { by: player.id });
    return ok({ declined: true });
  }

  // accept: there must be a pending offer from the OTHER player.
  const offerer = getOffer(game.id);
  if (!offerer || offerer === player.id) return fail(409, "no_offer");

  const result = await resolveGameRpc(game.id, "draw", "play");
  if (!result.ok) return fail(409, result.conflict ?? "conflict");
  clearOffer(game.id);
  await afterGameResolved(game, "draw", "play");
  return ok({ status: "draw" });
}
