import { getTournamentByPin, listPlayers } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp, withApi } from "@/lib/server/http";
import { isValidPin } from "@/lib/codes";

// POST /api/join/names { pin } — the "Velg navnet ditt" list for a tournament
// continued from a physical one: pre-registered names that nobody has claimed
// yet. No secrets (never the resume code). Empty list for ordinary tournaments.
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`join:${clientIp(req)}`, 120, 60_000)) return fail(429, "rate_limited");
  const body = await readJson<{ pin?: string }>(req);
  const pin = (body?.pin ?? "").toString().trim();
  if (!isValidPin(pin)) return fail(400, "invalid_pin");
  const t = await getTournamentByPin(pin);
  if (!t) return fail(404, "invalid_pin");
  if (t.status === "finished") return fail(409, "finished");
  const players = await listPlayers(t.id);
  const names = players
    .filter((p) => p.pre_registered && !p.claimed_at && p.status === "active")
    .sort((a, b) => (a.start_no ?? 0) - (b.start_no ?? 0))
    .map((p) => ({ id: p.id, displayName: p.display_name, club: p.club ?? null }));
  return ok({
    names,
    // Fresh (unlisted) joins: always in the lobby of an ordinary tournament; for a
    // continued one only when the physical tournament allowed late entry.
    canJoinFresh:
      t.status === "lobby" &&
      (!t.config.fromPhysical || t.config.fromPhysical.allowFreeJoin || t.current_round === 0),
    groupLabel: t.config.fromPhysical?.groupLabel ?? null,
  });
}
