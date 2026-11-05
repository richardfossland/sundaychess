import { authHost } from "@/lib/server/auth";
import { getPlayer, setPlayerStatus } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { defer } from "@/lib/server/defer";
import { channels, events } from "@/lib/realtime";
import { fail, ok, readJson, withApi } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";

// POST /api/lobby/kick — host removes a player from the LOBBY (bad/abusive name,
// or a ghost who left and never came back). Only valid before the tournament
// starts; once games are live the "absent" flow (a walkover) applies instead.
//
// M3: en lærers kick er endelig: status `kicked`, som /api/lobby/rejoin nekter.
// Bare `reason: "teacher"` er endelig. Alt annet gir `left`, som eleven selv kan angre:
// spøkelsessveipet (3 min uten presence), og en åpen fane med gammel JS som ikke sender
// `reason`. Ellers kunne en låst telefon gitt en elev permanent utkast.
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson<{
    tournamentId?: string;
    hostCode?: string;
    playerId?: string;
    reason?: string;
  }>(req);
  if (!body?.tournamentId || !body.playerId) return fail(400, "bad_request");
  // `getPlayer` below hands playerId straight to Postgres; a malformed one is a
  // client error (22P02 → false 503), not a missing player and not an outage.
  // (tournamentId is shape-checked inside authHost.)
  if (!isUuid(body.playerId)) return fail(400, "bad_request");

  const t = await authHost(body.tournamentId, body.hostCode, req);
  if (!t) return fail(401, "unauthorized");
  if (t.status !== "lobby") return fail(409, "not_lobby");

  // Guard against cross-tournament kicks: the target must belong to this lobby.
  const player = await getPlayer(body.playerId);
  if (!player || player.tournament_id !== t.id) return fail(404, "no_player");

  const status = body.reason === "teacher" ? "kicked" : "left";
  try {
    await setPlayerStatus(player.id, status);
  } catch (err) {
    // 0019 ikke kjørt ennå: CHECK-en kjenner ikke `kicked` (23514). Fjern eleven
    // likevel (som `left`) i stedet for å la læreren stå uten kick.
    if (status === "kicked" && (err as { code?: string })?.code === "23514") {
      console.warn("[lobby/kick] players.status mangler 'kicked' (migrasjon 0019)");
      await setPlayerStatus(player.id, "left");
    } else {
      throw err;
    }
  }
  // M1: the roster nudge is a hint layer, so it runs after the response (see
  // lib/server/defer.ts).
  defer(
    () => broadcast(channels.lobby(t.id), events.roster, { left: player.id }),
    "kick:roster",
  );
  return ok({ ok: true });
}
