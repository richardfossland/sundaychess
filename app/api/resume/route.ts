import {
  getPlayerByResume,
  getTournament,
  getTournamentByPin,
} from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { normalizeResumeCode, isValidPin } from "@/lib/codes";

// POST /api/resume — restore a student session from their resume code.
// Accepts { resumeCode, pin } or { resumeCode, tournamentId }. The resume code
// travels in the body only (it is a bearer token — spec §8).
export async function POST(req: Request) {
  // Generous per-IP cap: after a wifi blip the whole class resumes at once
  // from one school NAT IP.
  if (!rateLimit(`resume:${clientIp(req)}`, 120, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{
    resumeCode?: string;
    pin?: string;
    tournamentId?: string;
  }>(req);

  const resumeCode = normalizeResumeCode(body?.resumeCode?.toString() ?? "");
  if (resumeCode.length < 6) return fail(400, "invalid_code");

  const tournament = body?.tournamentId
    ? await getTournament(body.tournamentId)
    : body?.pin && isValidPin(body.pin)
      ? await getTournamentByPin(body.pin.trim())
      : null;

  if (!tournament) return fail(404, "not_found");

  const player = await getPlayerByResume(tournament.id, resumeCode);
  if (!player) return fail(404, "invalid_code");

  return ok({
    tournamentId: tournament.id,
    playerId: player.id,
    displayName: player.display_name,
    tournamentStatus: tournament.status,
  });
}
