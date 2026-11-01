import { createTournament, DEFAULT_CONFIG } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp, withApi } from "@/lib/server/http";
import { signPairToken } from "@/lib/server/pair";
import { getHost } from "@/lib/server/auth";
import { resolveTiebreaks } from "@/lib/tournament/tiebreaks";
import { isVariant } from "@/lib/chess/variants";
import type { TournamentConfig } from "@/lib/types";

// POST /api/tournament — create a tournament. In Phase 1 the config is the
// default; the Phase 4 wizard posts a full config here.
//
// OWNER WIRING: if a Sunday Account host is signed in (allow-listed), the new
// tournament is stamped with their user id so it shows up in their dashboard.
// Anonymous create still works exactly as before (owner stays null) — getHost()
// returns null without throwing, so the host code remains the only required key.
async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`create:${clientIp(req)}`, 10, 60_000)) {
    return fail(429, "rate_limited");
  }
  const host = await getHost(); // null for anonymous create — never throws
  const body = await readJson<{ title?: string; config?: Partial<TournamentConfig> }>(req);

  const config: TournamentConfig = { ...DEFAULT_CONFIG, ...(body?.config ?? {}) };
  // Clamp to allowed ranges (defence against a hand-crafted request).
  if (config.format !== "cup") config.format = "league";
  config.leagueRounds = Math.min(7, Math.max(3, Math.round(config.leagueRounds)));
  if (![0, 4, 8, 16].includes(config.playoffSize)) config.playoffSize = 0;
  if (!config.playoff) config.playoffSize = 0;
  if (config.playoff && config.playoffSize === 0) config.playoffSize = 8;
  if (
    config.roundTimerSec !== null &&
    ![300, 600, 900].includes(config.roundTimerSec)
  ) {
    config.roundTimerSec = null;
  }
  config.reactions = config.reactions === true;
  if (!isVariant(config.variant)) config.variant = "standard";
  if (config.clockSec != null && ![180, 300, 600].includes(config.clockSec)) {
    config.clockSec = null;
  }
  // teams: 2-4 trimmed, unique, non-empty names — else individual tournament
  if (Array.isArray(config.teams)) {
    const names = config.teams
      .map((n) => String(n).trim().slice(0, 20))
      .filter(Boolean);
    config.teams =
      names.length >= 2 && names.length <= 4 && new Set(names).size === names.length
        ? names
        : [];
  } else {
    config.teams = [];
  }
  // Teacher's private note-to-self — trim + cap, same as the config route's
  // own sanitization (app/api/tournament/[id]/config/route.ts); drop it
  // entirely rather than storing an empty string.
  if (typeof config.notes === "string") {
    const trimmed = config.notes.trim().slice(0, 280);
    if (trimmed) config.notes = trimmed;
    else delete config.notes;
  } else {
    delete config.notes;
  }

  // Server-only marker: never accepted from a client (only /from-physical sets it).
  delete config.fromPhysical;
  // Optional pairing config (validated; absent ⇒ legacy Monrad adapter).
  if (!["monrad", "swiss", "roundRobin"].includes(config.pairingSystem as string)) delete config.pairingSystem;
  if (config.pairingSystem !== "roundRobin") delete config.doubleRoundRobin;
  else config.doubleRoundRobin = config.doubleRoundRobin === true;
  if (config.byePoints !== 0.5) delete config.byePoints;
  if (Array.isArray(config.tiebreaks)) config.tiebreaks = resolveTiebreaks(config.tiebreaks);
  else delete config.tiebreaks;

  const title = body?.title?.toString().slice(0, 80).trim() || null;

  const t = await createTournament(title, config, host?.id ?? null);
  return ok({
    id: t.id,
    joinPin: t.join_pin,
    hostCode: t.host_code,
    pairToken: await signPairToken(t.id, t.host_code),
  });
}

// A DB failure is a transient 503 (stable code), not a bespoke 500.
export const POST = withApi(handlePost);
