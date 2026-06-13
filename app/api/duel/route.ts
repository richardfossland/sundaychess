import { addPlayer, createTournament, DEFAULT_CONFIG } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { isVariant } from "@/lib/chess/variants";
import { normalizeBestOf } from "@/lib/duel/match";
import type { TournamentConfig } from "@/lib/types";

// POST /api/duel — create a 1v1 duel and add the creator as the first player.
// The creator gets a resume code (bearer token) in the body only; they share
// the join PIN / QR with the opponent, who joins via /api/duel/join.
export async function POST(req: Request) {
  if (!rateLimit(`duel:${clientIp(req)}`, 10, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{
    name?: string;
    bestOf?: number;
    clockSec?: number | null;
    variant?: string;
  }>(req);

  const name = (body?.name ?? "").toString().trim();
  if (name.length < 1) return fail(400, "missing_name");

  const config: TournamentConfig = {
    ...DEFAULT_CONFIG,
    format: "duel",
    bestOf: normalizeBestOf(body?.bestOf),
    leagueRounds: 3, // unused by duels; kept in valid range
    playoff: false,
    playoffSize: 0,
    roundTimerSec: null,
    variant: isVariant(body?.variant) ? body.variant : "standard",
    clockSec:
      body?.clockSec != null && [180, 300, 600].includes(body.clockSec)
        ? body.clockSec
        : null,
  };

  try {
    const t = await createTournament(name.slice(0, 40), config);
    const player = await addPlayer(t.id, name);
    return ok({
      tournamentId: t.id,
      joinPin: t.join_pin,
      playerId: player.id,
      resumeCode: player.resume_code,
      displayName: player.display_name,
    });
  } catch (err) {
    console.error("[duel create]", err);
    return fail(500, "create_failed");
  }
}
