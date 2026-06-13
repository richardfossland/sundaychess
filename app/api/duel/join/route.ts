import { addPlayer, getTournamentByPin, listPlayers } from "@/lib/server/store";
import { startDuel } from "@/lib/server/duel";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { isValidPin } from "@/lib/codes";

// POST /api/duel/join — the challenged player joins a duel by PIN (scanned from
// the creator's QR code). When they're the second player, the match kicks off
// immediately: game 1 is created server-side and both clients see it live.
export async function POST(req: Request) {
  if (!rateLimit(`dueljoin:${clientIp(req)}`, 30, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{ pin?: string; name?: string }>(req);
  const pin = (body?.pin ?? "").toString().trim();
  const name = (body?.name ?? "").toString().trim();

  if (!isValidPin(pin)) return fail(400, "invalid_pin");
  if (name.length < 1) return fail(400, "missing_name");

  const t = await getTournamentByPin(pin);
  if (!t || t.config?.format !== "duel") return fail(404, "invalid_pin");
  if (t.status !== "lobby") return fail(409, "duel_full");

  const players = await listPlayers(t.id);
  if (players.length >= 2) return fail(409, "duel_full");

  try {
    const player = await addPlayer(t.id, name);
    await broadcast(channels.lobby(t.id), events.roster, { joined: player.id });
    // Both players present → start game 1.
    await startDuel(t.id);
    return ok({
      tournamentId: t.id,
      playerId: player.id,
      resumeCode: player.resume_code,
      displayName: player.display_name,
    });
  } catch (err) {
    console.error("[duel join]", err);
    return fail(500, "join_failed");
  }
}
