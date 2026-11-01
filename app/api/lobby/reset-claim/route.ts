import { authHost } from "@/lib/server/auth";
import { getPlayer, resetClaim } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { fail, ok, readJson, withApi } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";

// POST /api/lobby/reset-claim — host frees a claimed pre-registered name (wrong
// student took it). A new resume code is issued, so the old device is locked out.
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson<{ tournamentId?: string; hostCode?: string; playerId?: string }>(req);
  if (!body?.tournamentId || !isUuid(body.playerId)) return fail(400, "bad_request");
  const t = await authHost(body.tournamentId, body.hostCode, req);
  if (!t) return fail(401, "unauthorized");
  const player = await getPlayer(body.playerId as string);
  if (!player || player.tournament_id !== t.id) return fail(404, "no_player");
  if (!player.pre_registered) return fail(409, "not_pre_registered");
  const updated = await resetClaim(t.id, player.id);
  if (!updated) return fail(404, "no_player");
  defer(() => broadcast(channels.lobby(t.id), events.roster, { left: player.id }), "reset-claim:roster");
  return ok({ ok: true });
}
