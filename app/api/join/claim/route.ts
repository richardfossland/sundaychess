import { claimPlayer, getTournamentByPin } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp, withApi } from "@/lib/server/http";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { isUuid, isValidPin } from "@/lib/codes";

// POST /api/join/claim { pin, playerId } — a student takes a pre-registered name.
// Atomic in the database (claim_player, 0017): of two simultaneous claims exactly
// one wins; the other gets 409 `already_claimed`. The resume code is issued here
// and only here. Allowed until the tournament is finished (a latecomer can claim
// between rounds); the host can free a wrongly claimed name (/api/lobby/reset-claim).
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`join:${clientIp(req)}`, 120, 60_000)) return fail(429, "rate_limited");
  const body = await readJson<{ pin?: string; playerId?: string }>(req);
  const pin = (body?.pin ?? "").toString().trim();
  if (!isValidPin(pin)) return fail(400, "invalid_pin");
  if (!isUuid(body?.playerId)) return fail(400, "bad_request");

  const t = await getTournamentByPin(pin);
  if (!t) return fail(404, "invalid_pin");
  if (t.status === "finished") return fail(409, "finished");

  const player = await claimPlayer(t.id, body!.playerId as string);
  if (!player) return fail(409, "already_claimed");
  defer(
    () => broadcast(channels.lobby(t.id), events.roster, { joined: player.id }),
    "claim:roster",
  );
  return ok({
    tournamentId: t.id,
    playerId: player.id,
    resumeCode: player.resume_code,
    displayName: player.display_name,
    team: player.team ?? null,
  });
}
